/**
 * 原理图意图生成 Prompt
 * 输入：RequirementSpec + BOMItem[]
 * 输出：SchematicIntent JSON（modules + connections + networks + pinTable）
 * 不生成门级原理图，仅描述模块级连接意图
 */
import type { AiMessage, RequirementSpec, BOMItem } from '@shared/types';

const SYSTEM_PROMPT = `You are a senior electronics engineer specializing in circuit design. Based on the given RequirementSpec and BOM list, generate a SchematicIntent JSON that describes module-level connections, network categories, and pin assignments.

## Output Format
Return ONLY a JSON object (no markdown fences, no explanation):

{
  "modules": [
    {
      "id": "power",
      "name": "Power Supply",
      "description": "3.3V LDO regulation from USB 5V input",
      "components": ["U2", "C1", "C2", "C3"],
      "mermaidBlock": "subgraph Power[Power Supply]\\n  USB[USB 5V] --> LDO[AMS1117-3.3]\\n  LDO --> VCC3V3[3.3V Rail]\\nend"
    }
  ],
  "connections": [
    {
      "from": { "designator": "U2", "pin": "VOUT" },
      "to": { "designator": "U1", "pin": "VCC" },
      "netName": "VCC_3V3",
      "networkType": "power",
      "notes": "Main 3.3V power rail"
    }
  ],
  "networks": [
    {
      "type": "power",
      "nets": ["VCC_5V", "VCC_3V3", "GND"],
      "description": "Power distribution network"
    }
  ],
  "pinTable": [
    {
      "designator": "U1",
      "pin": "GPIO2",
      "netName": "I2C_SDA",
      "direction": "bidirectional",
      "description": "I2C data line to sensor"
    }
  ]
}

## Rules
1. Group components into functional modules matching BOM subsystems (Core, Power, Communication, Display, Sensor, Interface, Protection)
2. Each module must include a mermaidBlock using Mermaid flowchart syntax (subgraph + arrows)
3. mermaidBlock uses \\n for newlines, NOT actual line breaks inside the JSON string
4. connections must reference valid designators from the BOM
5. networkType categories: power (VCC/GND rails), communication (I2C/SPI/UART/USB), control (GPIO/PWM/interrupt), analog (ADC/DAC/sensor signals)
6. pinTable should cover all critical pins: power pins, communication buses, control signals, analog inputs
7. direction: input (sensor/button input), output (LED/motor drive), bidirectional (I2C SDA), power (VCC/GND)
8. netName must be consistent across connections and pinTable
9. Do NOT generate gate-level schematics — focus on module-level block connections
10. Include decoupling capacitor connections to their associated IC power pins`;

/** 将 RequirementSpec + BOMItem[] 序列化为 prompt 上下文 */
function buildContext(spec: RequirementSpec, bomItems: BOMItem[]): string {
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
  addField('Display', spec.display.value);
  addField('Sensors', spec.sensors.value);

  if (spec.functionalModules.length > 0) {
    lines.push('\n## Functional Modules');
    for (const mod of spec.functionalModules) {
      lines.push(`- [${mod.priority}] ${mod.name}: ${mod.description} (components: ${mod.components.join(', ')})`);
    }
  }

  lines.push('\n## BOM List');
  for (const item of bomItems) {
    lines.push(`- ${item.designator}: ${item.comment} [${item.footprint}] x${item.quantity} (${item.subsystem})`);
  }

  return lines.join('\n');
}

export function buildSchematicPrompt(
  spec: RequirementSpec,
  bomItems: BOMItem[],
  language: 'zh' | 'en'
): AiMessage[] {
  const langInstruction = language === 'zh'
    ? '\n\nIMPORTANT: description and notes fields MUST be in Simplified Chinese.'
    : '\n\nIMPORTANT: description and notes fields MUST be in English.';

  return [
    { role: 'system', content: SYSTEM_PROMPT + langInstruction },
    { role: 'user', content: buildContext(spec, bomItems) },
  ];
}
