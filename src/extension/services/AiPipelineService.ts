/**
 * AI 管线编排器，按顺序执行五阶段串联：
 *
 * 数据流：
 *   AnalysisRequest → runRequirementStage() → RequirementSpec
 *     → runBomStage(spec) → BOMItem[] + ProcurementItem[]
 *     → runSchematicStage(spec, bomItems) → SchematicIntent
 *     → runPcbLayoutStage(spec, bomItems, schematic) → PCBLayoutPlan
 *     → runDesignReviewStage(spec, bomItems, schematic, pcbLayout) → DesignReviewResult
 *
 * 各阶段可独立调用，通过 lastSpec/lastBomItems/lastSchematic/lastPcbLayout 缓存传递
 * 错误处理：handleStageError() → sendPanelError() → 中断后续阶段
 * 并发控制：isRunning flag 防止并行任务
 * 流式调用：委托 pipelineStreamRunner.streamWithRetry()（含 10 次 / 15s 重试）
 * 设计审查：先执行本地规则引擎（RuleEngineService），再调用 AI 深度审查，合并结果
 */
import * as vscode from 'vscode';
import type { AnalysisRequest, RequirementSpec, BOMItem, SchematicIntent, PCBLayoutPlan, PipelineStage, AiErrorCode, ArtifactKey } from '@shared/types';
import { AiAdapter, AiAdapterError, classifyError } from '../adapters/AiAdapter';
import { buildRequirementPrompt } from '../prompts/requirementPrompt';
import { buildBomPrompt } from '../prompts/bomPrompt';
import { buildSchematicPrompt } from '../prompts/schematicPrompt';
import { buildPcbLayoutPrompt } from '../prompts/pcbLayoutPrompt';
import { buildDesignReviewPrompt } from '../prompts/designReviewPrompt';
import { ProcurementService } from './ProcurementService';
import {
  parseSchematicIntent,
  parsePcbLayoutPlan,
  parseBomItems,
  parseRequirementSpec,
  parseDesignReviewFindings,
} from './artifactParsers';
import type { SidePanelProvider } from '../providers/SidePanelProvider';
import { ReportPanelManager } from '../providers/ReportPanelManager';
import { deriveOverview } from './overviewDeriver';
import { streamWithRetry, type StreamRunnerDeps } from './pipelineStreamRunner';
import { runAllRules } from './RuleEngineService';

export class AiPipelineService {
  private isRunning = false;
  private isRegenerating = false;
  private readonly adapter: AiAdapter;
  private readonly procurement = new ProcurementService();
  private readonly streamDeps: StreamRunnerDeps;
  lastSpec: RequirementSpec | null = null;
  lastBomItems: BOMItem[] = [];
  lastSchematic: SchematicIntent | null = null;
  lastPcbLayout: PCBLayoutPlan | null = null;

  /** 管线全部完成后的回调（由 SessionManager 接线用于自动保存） */
  onPipelineComplete?: () => void;

  /** 单阶段完成后的回调（由 activate.ts 接线用于更新 ArtifactState） */
  onStageComplete?: (stage: ArtifactKey) => void;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly panelProvider: SidePanelProvider,
  ) {
    this.adapter = new AiAdapter(secrets, (msg) => this.outputChannel.appendLine(msg));
    this.streamDeps = {
      adapter: this.adapter,
      panelProvider: this.panelProvider,
      outputChannel: this.outputChannel,
      sendPanelStatus: (stage, progress) => this.sendPanelStatus(stage, progress),
    };
  }

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

  private getConfig() {
    const config = vscode.workspace.getConfiguration('aiEda');
    return {
      model: config.get<string>('model', 'claude-sonnet-4-6'),
      language: config.get<'zh' | 'en'>('reportLanguage', 'zh'),
    };
  }

  private handleStageError(stage: string, err: unknown): void {
    const code = err instanceof AiAdapterError ? err.code : classifyError(err);
    const msg = err instanceof Error ? err.message : String(err);
    this.outputChannel.appendLine(`[Pipeline] ${stage} error: ${code} — ${msg}`);
    this.sendPanelError(code, msg);
  }

  async runRequirementStage(request: AnalysisRequest): Promise<void> {
    if (this.isRunning) {
      this.sendPanelError('INVALID_REQUEST', '已有分析任务运行中，请等待完成');
      return;
    }

    this.isRunning = true;

    try {
      if (!(await this.ensureApiKey())) {
        this.sendPanelError('AUTH_ERROR', 'API Key 配置已取消');
        return;
      }

      this.sendPanelStatus('requirement', 0);
      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: { content: '正在分析需求，请稍候...', isStreaming: false },
        timestamp: Date.now(),
      });
      const { model, language } = this.getConfig();
      const inputText = request.rawText ?? '';

      const messages = buildRequirementPrompt(inputText, language);
      this.outputChannel.appendLine(`[Pipeline] requirement stage, model=${model}, inputLen=${inputText.length}`);

      const fullText = await streamWithRetry(this.streamDeps, model, messages);
      this.outputChannel.appendLine(`[Pipeline] fullText length=${fullText.length}, preview=${fullText.slice(0, 500)}`);

      this.sendPanelStatus('requirement', 80);
      const spec = parseRequirementSpec(fullText, request);

      if (!spec) {
        await this.runFallbackChat(inputText, model);
        return;
      }

      const overview = deriveOverview(spec);
      this.sendPanelStatus('requirement', 90);

      ReportPanelManager.openOrFocus(this.extensionUri);
      ReportPanelManager.postMessage({
        type: 'report_data',
        source: 'extension',
        payload: { report: { requirementSpec: spec, overview }, isStreaming: false },
        timestamp: Date.now(),
      });

      this.lastSpec = spec;

      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: { content: '需求分析完成，开始 BOM 选型...', isStreaming: false },
        timestamp: Date.now(),
      });
      this.sendPanelStatus('requirement', 100);
      this.outputChannel.appendLine('[Pipeline] requirement stage completed');

      await this.runBomStage(spec);
    } catch (err) {
      this.handleStageError('requirement', err);
    } finally {
      this.isRunning = false;
    }
  }

  async runBomStage(spec: RequirementSpec): Promise<void> {
    try {
      this.sendPanelStatus('bom', 0);
      this.outputChannel.appendLine('[Pipeline] bom stage started');

      const { model, language } = this.getConfig();
      const messages = buildBomPrompt(spec, language);
      const fullText = await streamWithRetry(this.streamDeps, model, messages);

      this.sendPanelStatus('bom', 50);
      const bomItems = parseBomItems(fullText);

      if (!bomItems || bomItems.length === 0) {
        this.sendPanelError('PARSE_ERROR', 'BOM JSON 解析失败');
        return;
      }

      this.outputChannel.appendLine(`[Pipeline] parsed ${bomItems.length} BOM items`);

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

      this.lastBomItems = bomItems;

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
      this.onStageComplete?.('bom');
      this.outputChannel.appendLine('[Pipeline] bom + procurement stage completed');

      await this.runSchematicStage(spec, bomItems);
    } catch (err) {
      this.handleStageError('bom', err);
    }
  }

  async runSchematicStage(spec: RequirementSpec, bomItems: BOMItem[]): Promise<void> {
    try {
      this.sendPanelStatus('schematic', 0);
      this.outputChannel.appendLine('[Pipeline] schematic stage started');

      const { model, language } = this.getConfig();
      const messages = buildSchematicPrompt(spec, bomItems, language);
      const fullText = await streamWithRetry(this.streamDeps, model, messages);

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
      this.onStageComplete?.('schematic');
      this.outputChannel.appendLine('[Pipeline] schematic stage completed');

      await this.runPcbLayoutStage(spec, bomItems, schematic);
    } catch (err) {
      this.handleStageError('schematic', err);
    }
  }

  async runPcbLayoutStage(spec: RequirementSpec, bomItems: BOMItem[], schematic: SchematicIntent): Promise<void> {
    try {
      this.sendPanelStatus('pcb_layout', 0);
      this.outputChannel.appendLine('[Pipeline] pcb_layout stage started');

      const { model, language } = this.getConfig();
      const messages = buildPcbLayoutPrompt(spec, bomItems, schematic, language);
      const fullText = await streamWithRetry(this.streamDeps, model, messages);

      this.sendPanelStatus('pcb_layout', 80);
      const plan = parsePcbLayoutPlan(fullText);

      if (!plan) {
        this.sendPanelError('PARSE_ERROR', 'PCBLayoutPlan JSON 解析失败');
        return;
      }

      this.outputChannel.appendLine(`[Pipeline] parsed pcb layout: ${plan.zones.length} zones, ${plan.placements.length} placements`);
      this.lastPcbLayout = plan;

      ReportPanelManager.postMessage({
        type: 'pcb_layout_data',
        source: 'extension',
        payload: { pcbLayoutPlan: plan },
        timestamp: Date.now(),
      });

      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: { content: 'PCB 布局规划完成，开始设计审查...', isStreaming: false },
        timestamp: Date.now(),
      });
      this.sendPanelStatus('pcb_layout', 100);
      this.onStageComplete?.('pcbLayout');
      this.outputChannel.appendLine('[Pipeline] pcb_layout stage completed');

      await this.runDesignReviewStage(spec, bomItems, schematic, plan);
    } catch (err) {
      this.handleStageError('pcb_layout', err);
    }
  }

  async runDesignReviewStage(
    spec: RequirementSpec,
    bomItems: BOMItem[],
    schematic: SchematicIntent | null,
    pcbLayout: PCBLayoutPlan | null,
  ): Promise<void> {
    try {
      this.sendPanelStatus('design_review', 0);
      this.outputChannel.appendLine('[Pipeline] design_review stage started');

      // Phase 1: 本地规则引擎检查
      this.sendPanelStatus('design_review', 10);
      const ruleResult = runAllRules({
        bomItems,
        schematicIntent: schematic,
        pcbLayoutPlan: pcbLayout,
        procurementItems: [],
      });
      this.outputChannel.appendLine(
        `[Pipeline] rule engine: ${ruleResult.findings.length} findings (${ruleResult.summary.criticalCount}C/${ruleResult.summary.warningCount}W/${ruleResult.summary.infoCount}I)`,
      );

      // Phase 2: AI 深度设计审查
      this.sendPanelStatus('design_review', 30);
      const { model, language } = this.getConfig();
      const messages = buildDesignReviewPrompt(spec, bomItems, schematic, pcbLayout, language);
      const fullText = await streamWithRetry(this.streamDeps, model, messages);

      this.sendPanelStatus('design_review', 80);
      const aiFindings = parseDesignReviewFindings(fullText);

      // 合并规则 findings + AI findings
      const allFindings = [...ruleResult.findings, ...(aiFindings ?? [])];
      const summary = {
        criticalCount: allFindings.filter((f) => f.severity === 'critical').length,
        warningCount: allFindings.filter((f) => f.severity === 'warning').length,
        infoCount: allFindings.filter((f) => f.severity === 'info').length,
      };

      const designReviewResult = {
        findings: allFindings,
        summary,
        reviewedAt: new Date().toISOString(),
      };

      ReportPanelManager.postMessage({
        type: 'design_review_data',
        source: 'extension',
        payload: { designReviewResult },
        timestamp: Date.now(),
      });

      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: {
          content: `全部分析完成！需求 → BOM(${bomItems.length}项) → 原理图 → PCB 布局 → 设计审查(${allFindings.length}项发现)，请查看 Report Tab。`,
          isStreaming: false,
        },
        timestamp: Date.now(),
      });
      this.sendPanelStatus('design_review', 100);
      this.onStageComplete?.('designReview');
      this.outputChannel.appendLine(`[Pipeline] design_review stage completed — ${allFindings.length} total findings — full pipeline done`);
      if (!this.isRegenerating) this.onPipelineComplete?.();
    } catch (err) {
      this.handleStageError('design_review', err);
    }
  }

  private sendPanelStatus(stage: PipelineStage, progress: number): void {
    this.panelProvider.postMessage({ type: 'generation_status', source: 'extension', payload: { stage, progress }, timestamp: Date.now() });
  }

  private sendPanelError(code: AiErrorCode | string, message: string): void {
    this.panelProvider.postMessage({ type: 'error', source: 'extension', payload: { code: String(code), message }, timestamp: Date.now() });
  }

  /** 非硬件需求时的普通对话回退，直接流式回答不强制 JSON */
  private async runFallbackChat(inputText: string, model: string): Promise<void> {
    const messages = [
      { role: 'user' as const, content: inputText },
    ];
    await streamWithRetry(this.streamDeps, model, messages, true);
  }

  /**
   * 从指定阶段开始重新生成（cascade 模式：含所有下游）
   * 前置条件：对应的上游缓存数据必须存在
   */
  async regenerateFrom(stage: ArtifactKey): Promise<void> {
    if (this.isRunning) {
      this.sendPanelError('INVALID_REQUEST', '已有分析任务运行中，请等待完成');
      return;
    }

    if (!this.lastSpec) {
      this.sendPanelError('INVALID_REQUEST', '没有需求数据，请先运行分析');
      return;
    }

    this.isRunning = true;
    this.isRegenerating = true;

    try {
      if (!(await this.ensureApiKey())) {
        this.sendPanelError('AUTH_ERROR', 'API Key 配置已取消');
        return;
      }

      this.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: { content: `正在重新生成 ${stage}...`, isStreaming: false },
        timestamp: Date.now(),
      });

      switch (stage) {
        case 'bom':
          await this.runBomStage(this.lastSpec);
          break;
        case 'schematic':
          await this.runSchematicStage(this.lastSpec, this.lastBomItems);
          break;
        case 'pcbLayout':
          await this.runPcbLayoutStage(this.lastSpec, this.lastBomItems, this.lastSchematic!);
          break;
        case 'procurement': {
          // 单独重跑采购匹配（不调用 AI）
          this.sendPanelStatus('procurement', 0);
          const procItems = await this.procurement.matchAll(this.lastBomItems, (cur, total) => {
            this.sendPanelStatus('procurement', Math.round((cur / total) * 100));
          });
          ReportPanelManager.postMessage({
            type: 'procurement_data',
            source: 'extension',
            payload: { procurementItems: procItems },
            timestamp: Date.now(),
          });
          this.sendPanelStatus('procurement', 100);
          this.onStageComplete?.('procurement');
          break;
        }
        case 'designReview':
          await this.runDesignReviewStage(
            this.lastSpec, this.lastBomItems,
            this.lastSchematic, this.lastPcbLayout,
          );
          break;
        default:
          this.sendPanelError('INVALID_REQUEST', `不支持从 ${stage} 阶段重新生成`);
      }
    } catch (err) {
      this.handleStageError(stage, err);
    } finally {
      this.isRunning = false;
      this.isRegenerating = false;
    }
  }
}
