/** OpenClawプラグインSDKのAPI型 */
export interface OpenClawPluginApi {
  registerTool: (tool: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description?: string; enum?: string[] }>;
      required?: string[];
    };
    execute: (params: Record<string, unknown>) => Promise<unknown>;
  }) => void;
}
