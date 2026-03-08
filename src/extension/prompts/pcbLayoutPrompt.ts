/**
 * PCB 布局规划 Prompt
 * 输入：RequirementSpec + BOMItem[] + SchematicIntent
 * 输出：PCBLayoutPlan JSON（boardSize + zones + placements + routing + constraints）
 * 依赖原理图意图的 networks/modules 信息进行走线分类和分区规划
 */
import type { AiMessage, RequirementSpec, BOMItem, SchematicIntent } from '@shared/types';

const SYSTEM_PROMPT = `You are a senior PCB layout engineer. Based on the given RequirementSpec, BOM list, and SchematicIntent, generate a PCBLayoutPlan JSON that describes board dimensions, functional zones, component placement, routing guidelines, and layout constraints.

## Output Format
Return ONLY a JSON object (no markdown fences, no explanation):

{
  "boardSize": {
    "width": 60,
    "height": 40,
    "source": "ai_inferred",
    "status": "pending_confirmation",
    "confidence": 0.7
  },
  "layerCount": {
    "value": 2,
    "source": "ai_inferred",
    "status": "pending_confirmation",
    "confidence": 0.8,
    "reasoning": "Simple design with no high-speed signals, 2-layer sufficient"
  },
  "zones": [
    {
      "id": "zone-power",
      "name": "Power Zone",
      "purpose": "Voltage regulation and power distribution",
      "relativePosition": "top-left",
      "components": ["U2", "C1", "C2", "C3"],
      "color": "#e74c3c"
    }
  ],
  "placements": [
    {
      "designator": "U1",
      "zone": "zone-mcu",
      "placementNotes": "Center of board, oriented for shortest trace to peripherals",
      "priority": "critical"
    }
  ],
  "routingGuidelines": [
    {
      "netName": "VCC_3V3",
      "guideline": "Use wide traces (min 0.5mm), star topology from regulator output",
      "category": "power",
      "severity": "mandatory"
    }
  ],
  "constraints": [
    {
      "type": "keep_out",
      "description": "Antenna keep-out zone: no copper pour or traces within 5mm of antenna",
      "affectedComponents": ["U1"],
      "reference": "ESP32 hardware design guidelines"
    }
  ]
}

## Rules
1. boardSize: if user provided sizeLimit, use it with source:"user_provided"; otherwise AI estimates based on component count, with source:"ai_inferred" and status:"pending_confirmation"
2. layerCount: 2 for simple designs, 4 for complex/high-speed; always explain reasoning
3. zones: group by function — Power, MCU, Communication, Display, Sensor, Interface, Connector
4. relativePosition: use compass directions — "top-left", "center", "bottom-right", etc.
5. color: use hex colors for zone visualization — red for power, blue for MCU, green for communication, etc.
6. placements: map every BOM designator to a zone, prioritize critical components first
7. priority: critical (power regulators, MCU, connectors near edge), important (communication ICs, sensors), flexible (passives, LEDs)
8. routingGuidelines: cover power rails (wide traces), high-speed signals (impedance control), analog signals (guard traces)
9. severity: mandatory (safety/functional requirement), recommended (best practice)
10. constraints: include keep_out (antenna, crystal), thermal (power components), clearance (high voltage), placement (connectors at board edge)
11. USB/connectors must be placed at board edge
12. Decoupling capacitors must be placed close to their associated IC power pins`;

/** 构建上下文 */
function buildContext(
  spec: RequirementSpec,
  bomItems: BOMItem[],
  schematic: SchematicIntent
): string {
  const lines: string[] = ['## Project Requirements'];

  const addField = (label: string, value: unknown) => {
    if (value !== null && value !== undefined) {
      const display = Array.isArray(value) ? value.join(', ') : String(value);
      lines.push(`- ${label}: ${display}`);
    }
  };

  addField('Project', spec.projectName.value);
  addField('Description', spec.projectDescription.value);
  addField('MCU', spec.mcu.value);
  addField('Power Supply', spec.power.value);
  addField('Communication', spec.communication.value);
  addField('Size Limit', spec.sizeLimit.value);
  addField('Production Intent', spec.productionIntent.value);

  lines.push('\n## BOM Summary');
  lines.push(`Total components: ${bomItems.length}`);
  for (const item of bomItems) {
    lines.push(`- ${item.designator}: ${item.comment} [${item.footprint}] x${item.quantity} (${item.subsystem})`);
  }

  lines.push('\n## Network Categories');
  for (const net of schematic.networks) {
    lines.push(`- ${net.type}: ${net.nets.join(', ')} — ${net.description}`);
  }

  lines.push('\n## Modules');
  for (const mod of schematic.modules) {
    lines.push(`- ${mod.name}: ${mod.description} (${mod.components.join(', ')})`);
  }

  return lines.join('\n');
}

export function buildPcbLayoutPrompt(
  spec: RequirementSpec,
  bomItems: BOMItem[],
  schematic: SchematicIntent,
  language: 'zh' | 'en'
): AiMessage[] {
  const langInstruction = language === 'zh'
    ? '\n\nIMPORTANT: All description, notes, guideline, reasoning, and purpose fields MUST be in Simplified Chinese.'
    : '\n\nIMPORTANT: All description, notes, guideline, reasoning, and purpose fields MUST be in English.';

  return [
    { role: 'system', content: SYSTEM_PROMPT + langInstruction },
    { role: 'user', content: buildContext(spec, bomItems, schematic) },
  ];
}
