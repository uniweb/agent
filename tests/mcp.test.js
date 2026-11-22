import { describe, it, expect } from 'vitest'
import { mcpServer, PROTOCOL_VERSIONS } from '../src/mcp.js'

const tools = [
  { name: 'hello', description: 'Says hello', inputSchema: { type: 'object', properties: {} }, run: async ({ who = 'you' }) => ({ text: `hello ${who}` }) },
  { name: 'nope', description: 'Refuses', inputSchema: { type: 'object', properties: {} }, run: async () => ({ text: 'not that', isError: true }) },
]
const server = () => mcpServer({ name: 'uniweb', version: '1.0.0', tools, instructions: 'Start with hello.' })

describe('mcpServer', () => {
  it('answers initialize in the version the client asked for, when it has it', async () => {
    const res = await server().handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    expect(res.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'uniweb' }, instructions: 'Start with hello.' })
  })

  it('answers with its newest version when it lacks the one asked for', async () => {
    const res = await server().handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } })
    expect(res.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0])
  })

  it('lists its tools without their code', async () => {
    const res = await server().handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(res.result.tools.map((t) => t.name)).toEqual(['hello', 'nope'])
    expect(res.result.tools[0]).not.toHaveProperty('run')
  })

  it('calls a tool and answers its text, marking a refusal', async () => {
    const s = server()
    expect((await s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hello', arguments: { who: 'Ana' } } })).result).toEqual({
      content: [{ type: 'text', text: 'hello Ana' }],
    })
    expect((await s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })).result).toMatchObject({ isError: true })
    const unknown = await s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'missing' } })
    expect(unknown.result.isError).toBe(true)
    expect(unknown.result.content[0].text).toMatch(/No tool missing\. The tools: hello, nope/)
  })

  it('answers no notification, pings, and refuses a method it lacks', async () => {
    const s = server()
    expect(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect((await s.handle({ jsonrpc: '2.0', id: 6, method: 'ping' })).result).toEqual({})
    expect((await s.handle({ jsonrpc: '2.0', id: 7, method: 'resources/list' })).error.code).toBe(-32601)
  })
})
