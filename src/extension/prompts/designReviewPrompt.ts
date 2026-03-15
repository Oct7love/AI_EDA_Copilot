/**
 * 设计审查 Prompt，输入全部上游产物，输出 DesignReviewFinding[] JSON
 * AI 审查维度：电源纹波、信号完整性、热设计、封装匹配、功能完整性
 */
import type { AiMessage, RequirementSpec, BOMItem, SchematicIntent, PCBLayoutPlan } from '@shared/types';

const SYSTEM_PROMPT = `You are a senior electronics design review engineer. Based on the provided project requirements, BOM, schematic intent, and PCB layout plan, perform a thorough design review and identify potential issues.

## Output Format
Return ONLY a JSON array of DesignReviewFinding objects (no markdown fences, no explanation):

[
  {
    "id": "AI-001",
    "category": "power_ripple",
    "severity": "warning",
    "title": "LDO output may have excessive ripple",
    "description": "The AMS1117-3.3 output only has a 10uF capacitor. For clean 3.3V supply to the ADC, additional filtering may be needed.",
    "affectedComponents": ["U2", "C5"],
    "suggestion": "Add a 100nF ceramic capacitor close to U2 output pin, and consider adding a 22uF tantalum capacitor for low-frequency filtering.",
    "stage": "cross_stage",
    "ruleSource": "ai_analysis",
    "confidence": 0.8
  }
]

## Review Categories
Analyze the design across these dimensions:

1. **power_ripple** — LDO/DC-DC output ripple, decoupling adequacy, input/output cap sizing
2. **signal_integrity** — Reflection risks, crosstalk, impedance discontinuities, termination
3. **thermal** — Heat path rationality, power density, thermal relief needs
4. **footprint_match** — Package vs datasheet consistency, land pattern adequacy
5. **clearance** — Spacing between high-voltage/sensitive nets, creepage/clearance
6. **layout** — Component placement concerns, routing congestion, mechanical interference
7. **general** — Missing protection (ESD, TVS, reverse-polarity), functional completeness

## Severity Levels
- **critical**: Design will likely fail or cause damage
- **warning**: Design may have reliability/performance issues
- **info**: Optimization suggestions, best practice recommendations

## Rules
1. Focus on real, actionable findings — not generic advice
2. Reference specific components by designator when possible
3. Each finding must have a concrete suggestion
4. confidence: 0.6~1.0 (higher = more certain)
5. Do NOT duplicate rules that a deterministic rule engine would catch (empty footprint, duplicate designator)
6. Focus on domain expertise that requires understanding circuit relationships
7. Generate 5~15 findings for a typical design`;

/** 将上游产物序列化为审查上下文 */
function buildReviewContext(
  spec: RequirementSpec,
  bomItems: BOMItem[],
  schematic: SchematicIntent | null,
  pcbLayout: PCBLayoutPlan | null,
): string {
  const sections: string[] = [];

  // Requirements summary
  sections.push('## Project Requirements');
  if (spec.projectName.value) sections.push(`- Project: ${spec.projectName.value}`);
  if (spec.projectDescription.value) sections.push(`- Description: ${spec.projectDescription.value}`);
  if (spec.mcu.value) sections.push(`- MCU: ${spec.mcu.value}`);
  if (spec.power.value) sections.push(`- Power: ${spec.power.value}`);
  if (spec.communication.value) {
    const comm = Array.isArray(spec.communication.value)
      ? spec.communication.value.join(', ')
      : spec.communication.value;
    sections.push(`- Communication: ${comm}`);
  }

  // BOM summary
  sections.push(`\n## BOM (${bomItems.length} items)`);
  for (const item of bomItems) {
    let line = `- ${item.designator}: ${item.comment} [${item.footprint}] x${item.quantity}`;
    if (item.category) line += ` (${item.category})`;
    if (item.jlcPartNumber) line += ` LCSC:${item.jlcPartNumber}`;
    sections.push(line);
  }

  // Schematic intent
  if (schematic) {
    sections.push(`\n## Schematic Intent (${schematic.modules.length} modules, ${schematic.connections.length} connections)`);
    for (const mod of schematic.modules) {
      sections.push(`- Module: ${mod.name} — ${mod.description} [${mod.components.join(', ')}]`);
    }
    sections.push('\nKey connections:');
    for (const conn of schematic.connections.slice(0, 30)) {
      sections.push(`  ${conn.from.designator}.${conn.from.pin} → ${conn.to.designator}.${conn.to.pin} (${conn.networkType}: ${conn.netName})`);
    }
    if (schematic.connections.length > 30) {
      sections.push(`  ... and ${schematic.connections.length - 30} more connections`);
    }
  }

  // PCB layout plan
  if (pcbLayout) {
    sections.push(`\n## PCB Layout Plan`);
    sections.push(`- Board: ${pcbLayout.boardSize.width}x${pcbLayout.boardSize.height}mm, ${pcbLayout.layerCount.value} layers`);
    sections.push(`- Zones: ${pcbLayout.zones.map((z) => z.name).join(', ')}`);
    if (pcbLayout.constraints.length > 0) {
      sections.push('- Constraints:');
      for (const c of pcbLayout.constraints) {
        sections.push(`  [${c.type}] ${c.description}`);
      }
    }
    if (pcbLayout.routingGuidelines.length > 0) {
      sections.push('- Routing guidelines:');
      for (const g of pcbLayout.routingGuidelines) {
        sections.push(`  [${g.category}/${g.severity}] ${g.netName}: ${g.guideline}`);
      }
    }
  }

  return sections.join('\n');
}

export function buildDesignReviewPrompt(
  spec: RequirementSpec,
  bomItems: BOMItem[],
  schematic: SchematicIntent | null,
  pcbLayout: PCBLayoutPlan | null,
  language: 'zh' | 'en',
): AiMessage[] {
  const langInstruction = language === 'zh'
    ? '\n\nIMPORTANT: title, description, and suggestion fields MUST be in Simplified Chinese.'
    : '\n\nIMPORTANT: title, description, and suggestion fields MUST be in English.';

  return [
    { role: 'system', content: SYSTEM_PROMPT + langInstruction },
    { role: 'user', content: buildReviewContext(spec, bomItems, schematic, pcbLayout) },
  ];
}
