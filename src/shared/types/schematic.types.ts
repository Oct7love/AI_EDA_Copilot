/** 原理图意图类型 — 对齐 BACKEND_STRUCTURE §4.4 */

export interface SchematicIntent {
  modules: SchematicModule[];
  connections: ConnectionSpec[];
  networks: NetworkCategory[];
  pinTable: PinConnection[];
}

export interface SchematicModule {
  id: string;
  name: string;
  description: string;
  components: string[];
  /** Mermaid flowchart 子图语法，用于模块级框图渲染 */
  mermaidBlock?: string;
}

export interface ConnectionSpec {
  from: PinRef;
  to: PinRef;
  netName: string;
  networkType: 'power' | 'communication' | 'control' | 'analog';
  notes?: string;
}

export interface PinRef {
  designator: string;
  pin: string;
}

export interface NetworkCategory {
  type: 'power' | 'communication' | 'control' | 'analog';
  nets: string[];
  description: string;
}

export interface PinConnection {
  designator: string;
  pin: string;
  netName: string;
  direction: 'input' | 'output' | 'bidirectional' | 'power';
  description: string;
}
