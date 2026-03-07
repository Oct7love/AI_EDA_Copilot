import type { AiMessage } from '@shared/types';

const SYSTEM_PROMPT = `You are a senior electronics design engineer. Analyze the user's hardware project description and extract a structured RequirementSpec in JSON format.

## Output Format
Return ONLY a JSON object (no markdown fences, no explanation) with this exact structure:

{
  "projectName": { "value": "string|null", "source": "user_provided|ai_inferred", "status": "confirmed|pending_confirmation", "confidence": 0.0-1.0 },
  "projectDescription": { "value": "string|null", "source": "...", "status": "...", "confidence": ... },
  "mcu": { "value": "string|null", "source": "...", "status": "...", "confidence": ... },
  "power": { "value": "string|null", "source": "...", "status": "...", "confidence": ... },
  "communication": { "value": ["string"]|null, "source": "...", "status": "...", "confidence": ... },
  "display": { "value": "string|null", "source": "...", "status": "...", "confidence": ... },
  "sensors": { "value": ["string"]|null, "source": "...", "status": "...", "confidence": ... },
  "costRange": { "value": "string|null", "source": "...", "status": "...", "confidence": ... },
  "sizeLimit": { "value": "string|null", "source": "...", "status": "...", "confidence": ... },
  "productionIntent": { "value": "string|null", "source": "...", "status": "...", "confidence": ... },
  "powerConsumption": { "value": "string|null", "source": "...", "status": "...", "confidence": ... },
  "precision": { "value": "string|null", "source": "...", "status": "...", "confidence": ... },
  "additionalNotes": { "value": "string|null", "source": "...", "status": "...", "confidence": ... },
  "functionalModules": [
    { "name": "string", "description": "string", "components": ["string"], "priority": "core|optional" }
  ],
  "openQuestions": [
    { "id": "q1", "question": "string", "context": "string", "priority": "critical|important|optional", "resolved": false }
  ]
}

## Rules
1. Fields explicitly mentioned by user → source:"user_provided", status:"confirmed", confidence:1.0
2. Fields reasonably inferable (confidence >= 0.9) → source:"ai_inferred", status:"confirmed", confidence:0.9~0.95
3. Fields reasonably inferable (confidence 0.7~0.89) → source:"ai_inferred", status:"pending_confirmation", confidence:0.7~0.89
4. Fields not determinable → value:null, source:"ai_inferred", status:"pending_confirmation", confidence:0
5. When uncertain → add to openQuestions with appropriate priority (critical/important/optional)
6. functionalModules: break the project into logical modules with core/optional priority
7. Be thorough: infer communication protocols, power requirements, sensor types from context`;

export function buildRequirementPrompt(
  userInput: string,
  language: 'zh' | 'en'
): AiMessage[] {
  const langInstruction = language === 'zh'
    ? '\n\nIMPORTANT: All string values in the JSON (descriptions, questions, module names) MUST be in Simplified Chinese.'
    : '\n\nIMPORTANT: All string values in the JSON MUST be in English.';

  return [
    { role: 'system', content: SYSTEM_PROMPT + langInstruction },
    { role: 'user', content: userInput },
  ];
}
