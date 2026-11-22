/**
 * The Model Context Protocol, as a server of `@uniweb/agent`'s tools answers it.
 *
 * `mcpServer` handles one JSON-RPC message at a time and answers it, with no transport of its
 * own: a host that starts the server as a process carries the messages over its standard streams,
 * one per line, and a service carries them over HTTP. It answers the `initialize` era of the
 * protocol, which hosts speak today: `initialize`, `ping`, `tools/list` and `tools/call`.
 */

/** The protocol versions answered, newest first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

const ok = (id, result) => ({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })

/**
 * @param {object} options
 * @param {string} options.name - the server's name, as a host shows it
 * @param {string} options.version
 * @param {Array<{ name: string, description: string, inputSchema: object, run: (args: object) => Promise<{ text: string, isError?: boolean }> }>} options.tools
 * @param {string} [options.instructions] - what a host tells a model about the tools
 * @returns {{ handle: (message: object) => Promise<object|null> }} `null` for a notification
 */
export function mcpServer({ name, version, tools, instructions = null }) {
  const byName = new Map(tools.map((t) => [t.name, t]))

  async function callTool(toolName, args) {
    const tool = byName.get(toolName)
    if (!tool) return { content: [{ type: 'text', text: `No tool ${toolName}. The tools: ${[...byName.keys()].join(', ')}.` }], isError: true }
    const { text, isError } = await tool.run(args ?? {})
    return { content: [{ type: 'text', text: String(text ?? '') }], ...(isError ? { isError: true } : {}) }
  }

  async function handle(message) {
    if (!message || typeof message !== 'object') return null
    const { id, method, params } = message
    // A notification (`notifications/initialized`, a cancellation) asks for no answer.
    if (id === undefined || id === null) return null
    try {
      switch (method) {
        case 'initialize': {
          const asked = params?.protocolVersion
          return ok(id, {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name, version },
            ...(instructions ? { instructions } : {}),
          })
        }
        case 'ping':
          return ok(id, {})
        case 'tools/list':
          return ok(id, { tools: tools.map(({ name: n, description, inputSchema }) => ({ name: n, description, inputSchema })) })
        case 'tools/call':
          return ok(id, await callTool(params?.name, params?.arguments))
        default:
          return fail(id, -32601, `Method not found: ${method}`)
      }
    } catch (err) {
      return fail(id, -32603, String(err?.message ?? err))
    }
  }

  return { handle }
}
