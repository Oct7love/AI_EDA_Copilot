import * as vscode from 'vscode';
import type { AnalysisRequest, RequirementSpec, OverviewData, BOMItem, SchematicIntent } from '@shared/types';
import type { PipelineStage } from '@shared/types';
import { RETRYABLE_ERRORS, createRetryState } from '@shared/types';
import type { AiErrorCode } from '@shared/types';
import { AiAdapter, AiAdapterError, classifyError } from '../adapters/AiAdapter';
import { StreamBuffer } from './StreamBuffer';
import { buildRequirementPrompt } from '../prompts/requirementPrompt';
import { buildBomPrompt } from '../prompts/bomPrompt';
import { buildSchematicPrompt } from '../prompts/schematicPrompt';
import { buildPcbLayoutPrompt } from '../prompts/pcbLayoutPrompt';
import { ProcurementService } from './ProcurementService';
import {
  parseSchematicIntent,
  parsePcbLayoutPlan,
  parseBomItems,
  parseRequirementSpec,
} from './artifactParsers';
import type { SidePanelProvider } from '../providers/SidePanelProvider';
import { ReportPanelManager } from '../providers/ReportPanelManager';

export class AiPipelineService {
  private isRunning = false;
  private readonly adapter: AiAdapter;
  private readonly procurement = new ProcurementService();
  /** 上一次需求分析结果（后续阶段消费） */
  lastSpec: RequirementSpec | null = null;
  /** 上一次 BOM 结果（导出消费） */
  lastBomItems: BOMItem[] = [];
  /** 上一次原理图意图（PCB 阶段消费） */
  lastSchematic: SchematicIntent | null = null;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly panelProvider: SidePanelProvider,
  ) {
    this.adapter = new AiAdapter(secrets, (msg) => this.outputChannel.appendLine(msg));
  }

  /** 检查并引导用户配置 API Key */
  private async ensureApiKey(): Promise<boolean> {
    if (await this.adapter.hasApiKey()) return true;

    const key = await vscode.window.showInputBox({
      title: 'AI EDA Copilot — API Key',
      prompt: '请输入 OpenAI 兼容的 API Key（将加密存储在 VS Code SecretStorage 中）',
      password: true,
      ignoreFocusOut: true,
    });

    if (!key) return false;
    await this.secrets.store('aiEda.apiKey', key);
    return true;
  }

  /** 主管线入口：需求分析阶段 */
  async runRequirementStage(request: AnalysisRequest): Promise<void> {
    if (this.isRunning) {
      this.sendPanelError('INVALID_REQUEST', '已有分析任务运行中，请等待完成');
      return;
    }

    this.isRunning = true;

    try {
      // 检查 API Key
      if (!(await this.ensureApiKey())) {
        this.sendPanelError('AUTH_ERROR', 'API Key 配置已取消');
        return;
      }

      // 推送起始状态
      this.sendPanelStatus('requirement', 0);

      const config = vscode.workspace.getConfiguration('aiEda');
      const model = config.get<string>('model', 'claude-sonnet-4-6');
      const language = config.get<'zh' | 'en'>('reportLanguage', 'zh');
      const inputText = request.rawText ?? '';

      // 构建 prompt
      const messages = buildRequirementPrompt(inputText, language);
      this.outputChannel.appendLine(`[Pipeline] requirement stage, model=${model}, inputLen=${inputText.length}`);

      // 带重试的流式调用
      const fullText = await this.streamWithRetry(model, messages);

      // 诊断日志：打印 AI 原始输出
      this.outputChannel.appendLine(`[Pipeline] fullText length=${fullText.length}, preview=${fullText.slice(0, 500)}`);

      // 解析 JSON
      this.sendPanelStatus('requirement', 80);
      const spec = parseRequirementSpec(fullText, request);

      if (!spec) {
        this.sendPanelError('PARSE_ERROR', 'AI 输出 JSON 解析失败');
        return;
      }

      // 派生 Overview
      const overview = this.deriveOverview(spec);
      this.sendPanelStatus('requirement', 90);

      // 推送结构化数据到 Report Tab
      ReportPanelManager.openOrFocus(this.extensionUri);
      ReportPanelManager.postMessage({
        type: 'report_data',
        source: 'extension',
        payload: { report: { requirementSpec: spec, overview }, isStreaming: false },
        timestamp: Date.now(),
      });

      // 缓存 spec 供 BOM 阶段使用
      this.lastSpec = spec;

      // 完成通知
      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: { content: '需求分析完成，开始 BOM 选型...', isStreaming: false },
        timestamp: Date.now(),
      });
      this.sendPanelStatus('requirement', 100);
      this.outputChannel.appendLine('[Pipeline] requirement stage completed');

      // 自动串联 BOM 阶段
      await this.runBomStage(spec);
    } catch (err) {
      const code = err instanceof AiAdapterError ? err.code : classifyError(err);
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Pipeline] error: ${code} — ${msg}`);
      this.sendPanelError(code, msg);
    } finally {
      this.isRunning = false;
    }
  }

  /** BOM 生成 + 采购匹配阶段 */
  async runBomStage(spec: RequirementSpec): Promise<void> {
    try {
      this.sendPanelStatus('bom', 0);
      this.outputChannel.appendLine('[Pipeline] bom stage started');

      const config = vscode.workspace.getConfiguration('aiEda');
      const model = config.get<string>('model', 'claude-sonnet-4-6');
      const language = config.get<'zh' | 'en'>('reportLanguage', 'zh');

      // AI 生成 BOM
      const messages = buildBomPrompt(spec, language);
      const fullText = await this.streamWithRetry(model, messages);

      this.sendPanelStatus('bom', 50);
      const bomItems = parseBomItems(fullText);

      if (!bomItems || bomItems.length === 0) {
        this.sendPanelError('PARSE_ERROR', 'BOM JSON 解析失败');
        return;
      }

      this.outputChannel.appendLine(`[Pipeline] parsed ${bomItems.length} BOM items`);

      // JLC 料号匹配
      this.sendPanelStatus('procurement', 0);
      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: { content: `正在匹配 ${bomItems.length} 个元器件的 JLCPCB 料号...`, isStreaming: false },
        timestamp: Date.now(),
      });

      const procItems = await this.procurement.matchAll(bomItems, (cur, total) => {
        this.sendPanelStatus('procurement', Math.round((cur / total) * 100));
      });

      // 缓存 BOM 供导出
      this.lastBomItems = bomItems;

      // 推送到 Report Tab
      ReportPanelManager.postMessage({
        type: 'bom_data',
        source: 'extension',
        payload: { bomItems, isStreaming: false },
        timestamp: Date.now(),
      });

      ReportPanelManager.postMessage({
        type: 'procurement_data',
        source: 'extension',
        payload: { procurementItems: procItems },
        timestamp: Date.now(),
      });

      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: { content: `BOM 选型完成（${bomItems.length} 项），采购匹配已更新。开始原理图分析...`, isStreaming: false },
        timestamp: Date.now(),
      });
      this.sendPanelStatus('bom', 100);
      this.outputChannel.appendLine('[Pipeline] bom + procurement stage completed');

      // 自动串联原理图阶段
      await this.runSchematicStage(spec, bomItems);
    } catch (err) {
      const code = err instanceof AiAdapterError ? err.code : classifyError(err);
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Pipeline] bom error: ${code} — ${msg}`);
      this.sendPanelError(code, msg);
    }
  }

  /** 原理图意图生成阶段 */
  async runSchematicStage(spec: RequirementSpec, bomItems: BOMItem[]): Promise<void> {
    try {
      this.sendPanelStatus('schematic', 0);
      this.outputChannel.appendLine('[Pipeline] schematic stage started');

      const config = vscode.workspace.getConfiguration('aiEda');
      const model = config.get<string>('model', 'claude-sonnet-4-6');
      const language = config.get<'zh' | 'en'>('reportLanguage', 'zh');

      const messages = buildSchematicPrompt(spec, bomItems, language);
      const fullText = await this.streamWithRetry(model, messages);

      this.sendPanelStatus('schematic', 80);
      const schematic = parseSchematicIntent(fullText);

      if (!schematic) {
        this.sendPanelError('PARSE_ERROR', 'SchematicIntent JSON 解析失败');
        return;
      }

      this.outputChannel.appendLine(`[Pipeline] parsed schematic: ${schematic.modules.length} modules, ${schematic.connections.length} connections`);
      this.lastSchematic = schematic;

      ReportPanelManager.postMessage({
        type: 'schematic_data',
        source: 'extension',
        payload: { schematicIntent: schematic },
        timestamp: Date.now(),
      });

      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: { content: '原理图意图生成完成，开始 PCB 布局规划...', isStreaming: false },
        timestamp: Date.now(),
      });
      this.sendPanelStatus('schematic', 100);
      this.outputChannel.appendLine('[Pipeline] schematic stage completed');

      // 自动串联 PCB 布局阶段
      await this.runPcbLayoutStage(spec, bomItems, schematic);
    } catch (err) {
      const code = err instanceof AiAdapterError ? err.code : classifyError(err);
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Pipeline] schematic error: ${code} — ${msg}`);
      this.sendPanelError(code, msg);
    }
  }

  /** PCB 布局规划阶段 */
  async runPcbLayoutStage(spec: RequirementSpec, bomItems: BOMItem[], schematic: SchematicIntent): Promise<void> {
    try {
      this.sendPanelStatus('pcb_layout', 0);
      this.outputChannel.appendLine('[Pipeline] pcb_layout stage started');

      const config = vscode.workspace.getConfiguration('aiEda');
      const model = config.get<string>('model', 'claude-sonnet-4-6');
      const language = config.get<'zh' | 'en'>('reportLanguage', 'zh');

      const messages = buildPcbLayoutPrompt(spec, bomItems, schematic, language);
      const fullText = await this.streamWithRetry(model, messages);

      this.sendPanelStatus('pcb_layout', 80);
      const plan = parsePcbLayoutPlan(fullText);

      if (!plan) {
        this.sendPanelError('PARSE_ERROR', 'PCBLayoutPlan JSON 解析失败');
        return;
      }

      this.outputChannel.appendLine(`[Pipeline] parsed pcb layout: ${plan.zones.length} zones, ${plan.placements.length} placements`);

      ReportPanelManager.postMessage({
        type: 'pcb_layout_data',
        source: 'extension',
        payload: { pcbLayoutPlan: plan },
        timestamp: Date.now(),
      });

      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: { content: `全部分析完成！需求 → BOM(${bomItems.length}项) → 原理图 → PCB 布局，请查看 Report Tab。`, isStreaming: false },
        timestamp: Date.now(),
      });
      this.sendPanelStatus('pcb_layout', 100);
      this.outputChannel.appendLine('[Pipeline] pcb_layout stage completed — full pipeline done');
    } catch (err) {
      const code = err instanceof AiAdapterError ? err.code : classifyError(err);
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Pipeline] pcb_layout error: ${code} — ${msg}`);
      this.sendPanelError(code, msg);
    }
  }

  // 解析逻辑已提取到 artifactParsers.ts（纯函数，可独立测试）

  /** 带重试的流式调用，返回完整文本 */
  private async streamWithRetry(
    model: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    const retry = createRetryState();
    let lastError: Error | null = null;

    while (retry.attempt < retry.maxAttempts) {
      try {
        return await this.doStream(model, messages);
      } catch (err) {
        const code = err instanceof AiAdapterError ? err.code : classifyError(err);
        retry.lastError = code;
        retry.attempt++;

        if (!RETRYABLE_ERRORS.has(code)) throw err;

        if (retry.attempt >= retry.maxAttempts) {
          lastError = err instanceof Error ? err : new Error(String(err));
          break;
        }

        this.outputChannel.appendLine(
          `[Pipeline] retry ${retry.attempt}/${retry.maxAttempts}, error=${code}, wait=${retry.intervalMs}ms`
        );
        this.sendPanelStatus('requirement', 0);
        this.panelProvider.postMessage({
          type: 'ai_chat_response',
          source: 'extension',
          payload: {
            content: `[重试 ${retry.attempt}/${retry.maxAttempts}] ${code}，${retry.intervalMs / 1000}s 后重试...`,
            isStreaming: false,
          },
          timestamp: Date.now(),
        });

        await this.sleep(retry.intervalMs);
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  /** 单次流式调用，返回完整文本 */
  private async doStream(
    model: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    let fullText = '';

    const streamBuffer = new StreamBuffer((content) => {
      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: { content, isStreaming: true },
        timestamp: Date.now(),
      });
    });

    try {
      const stream = this.adapter.stream({ model, messages, stream: true });
      for await (const chunk of stream) {
        if (chunk.content) {
          fullText += chunk.content;
          streamBuffer.push(chunk.content);
        }
      }
    } finally {
      streamBuffer.dispose();
    }

    return fullText;
  }

  // extractJson / parseRequirementSpec 已提取到 artifactParsers.ts

  /** 从 RequirementSpec 本地派生 OverviewData */
  private deriveOverview(spec: RequirementSpec): OverviewData {
    const scalarFields: (keyof RequirementSpec)[] = [
      'projectName', 'projectDescription', 'mcu', 'power', 'communication',
      'display', 'sensors', 'costRange', 'sizeLimit', 'productionIntent',
      'powerConsumption', 'precision', 'additionalNotes',
    ];

    let filled = 0;
    let userProvided = 0;
    let aiInferred = 0;

    for (const key of scalarFields) {
      const field = spec[key] as { value: unknown; source: string };
      if (field.value !== null && field.value !== undefined) {
        filled++;
        if (field.source === 'user_provided') userProvided++;
        else aiInferred++;
      }
    }

    const totalFields = scalarFields.length;
    const readiness = Math.round((filled / totalFields) * 100);

    // 收集关键组件
    const keyComponents: string[] = [];
    if (spec.mcu.value) keyComponents.push(spec.mcu.value);
    if (spec.display.value) keyComponents.push(spec.display.value);
    if (spec.sensors.value) keyComponents.push(...spec.sensors.value);
    if (spec.communication.value) keyComponents.push(...spec.communication.value);

    // 风险评估
    const risks: string[] = [];
    if (!spec.mcu.value) risks.push('MCU 未确定，后续 BOM/原理图无法推进');
    if (!spec.power.value) risks.push('供电方案未明确，影响整体设计');
    if (spec.openQuestions.filter(q => q.priority === 'critical').length > 0) {
      risks.push(`存在 ${spec.openQuestions.filter(q => q.priority === 'critical').length} 个关键待确认问题`);
    }

    // 下一步
    const nextSteps: string[] = [];
    if (spec.openQuestions.length > 0) nextSteps.push('回答开放问题以提高需求完整度');
    if (filled < totalFields) nextSteps.push('补充缺失的需求字段');
    nextSteps.push('确认需求后进入 BOM 选型阶段');

    return {
      projectSummary: spec.projectDescription.value ?? spec.projectName.value ?? '未命名项目',
      readinessScore: readiness,
      totalFields,
      filledFields: filled,
      userProvidedCount: userProvided,
      aiInferredCount: aiInferred,
      modules: spec.functionalModules,
      keyComponents,
      risks,
      openQuestions: spec.openQuestions,
      nextSteps,
    };
  }

  // ── 辅助方法 ──

  private sendPanelStatus(stage: PipelineStage, progress: number): void {
    this.panelProvider.postMessage({
      type: 'generation_status',
      source: 'extension',
      payload: { stage, progress },
      timestamp: Date.now(),
    });
  }

  private sendPanelError(code: AiErrorCode | string, message: string): void {
    this.panelProvider.postMessage({
      type: 'error',
      source: 'extension',
      payload: { code: String(code), message },
      timestamp: Date.now(),
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
