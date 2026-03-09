/**
 * BOM 生成 Prompt，输入 RequirementSpec，输出 BOMItem[] JSON
 */
import type { AiMessage, RequirementSpec } from '@shared/types';

const SYSTEM_PROMPT = `You are a senior hardware engineer and BOM specialist. Based on the given RequirementSpec, generate a complete Bill of Materials (BOM) as a JSON array of BOMItem objects.

## Output Format
Return ONLY a JSON array (no markdown fences, no explanation):

[
  {
    "designator": "U1",
    "comment": "ESP32-S3-WROOM-1-N16R8",
    "footprint": "MODULE",
    "quantity": 1,
    "description": "Wi-Fi + BLE5.0 MCU module, 16MB Flash, 8MB PSRAM",
    "category": "MCU",
    "manufacturer": "Espressif",
    "mpn": "ESP32-S3-WROOM-1-N16R8",
    "subsystem": "Core",
    "source": "user_provided",
    "status": "confirmed",
    "confidence": 1.0,
    "reasoning": "User explicitly specified ESP32-S3",
    "alternatives": [
      { "comment": "ESP32-S3-WROOM-1-N8R2", "footprint": "MODULE", "reason": "Lower cost variant", "rank": 1 }
    ]
  }
]

## Rules
1. User explicitly mentioned component → source:"user_provided", status:"confirmed", confidence:1.0
2. Inferred support components (decoupling caps, voltage regulators, ESD, pull-ups) → source:"ai_inferred", status:"pending_confirmation", confidence:0.7~0.9
3. Designator prefixes: U=IC, R=Resistor, C=Capacitor, L=Inductor, D=Diode/LED, Q=Transistor, J=Connector, SW=Switch, Y=Crystal
4. Every IC must have associated decoupling capacitors (100nF minimum)
5. Use standard footprints: 0402/0603/0805 for passives, SOT-23/SOT-223 for regulators
6. Include all necessary passive components (pull-up/pull-down resistors, filter caps, etc.)
7. Provide at least 1 alternative for key ICs when possible
8. Group by subsystem: Core, Power, Communication, Display, Sensor, Interface, Protection
9. Do NOT include JLC part numbers — those will be matched separately
10. quantity must match the number of designators (e.g., "C1 C2" → quantity: 2)`;

/** 将 RequirementSpec 序列化为 BOM prompt 的上下文 */
function specToContext(spec: RequirementSpec): string {
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
  addField('Cost Range', spec.costRange.value);
  addField('Size Limit', spec.sizeLimit.value);
  addField('Power Consumption', spec.powerConsumption.value);

  if (spec.functionalModules.length > 0) {
    lines.push('\n## Functional Modules');
    for (const mod of spec.functionalModules) {
      lines.push(`- [${mod.priority}] ${mod.name}: ${mod.description} (components: ${mod.components.join(', ')})`);
    }
  }

  return lines.join('\n');
}

export function buildBomPrompt(
  spec: RequirementSpec,
  language: 'zh' | 'en'
): AiMessage[] {
  const langInstruction = language === 'zh'
    ? '\n\nIMPORTANT: description and reasoning fields MUST be in Simplified Chinese.'
    : '\n\nIMPORTANT: description and reasoning fields MUST be in English.';

  return [
    { role: 'system', content: SYSTEM_PROMPT + langInstruction },
    { role: 'user', content: specToContext(spec) },
  ];
}
