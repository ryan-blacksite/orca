import { describe, expect, it, vi } from 'vitest'
import {
  THREAD_ID,
  USER_MESSAGE,
  adapterFor,
  answerWithOpenedTurn,
  fakeCodex,
  identityFor,
  type Route
} from './codex-structured-session-adapter-fixture'
import { AgentModelCatalogStore } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import { agentModelCatalogSessionAccess } from '../native-chat/agent-model-catalog/agent-model-catalog-fingerprint'

describe('Codex structured Fast mode dispatch', () => {
  it('uses a stored provider-advertised Fast tier on the first turn after acquisition', async () => {
    const codex = fakeCodex({
      'model/list': () => ({
        data: [
          {
            model: 'gpt-live',
            supportedReasoningEfforts: [],
            serviceTiers: [{ id: 'priority-live-v2', name: 'Fast' }]
          }
        ],
        nextCursor: null
      })
    })
    codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-fast')
    const modelCatalog = new AgentModelCatalogStore()
    const access = agentModelCatalogSessionAccess(modelCatalog, 'codex', '/codex/home')!
    modelCatalog.recordSuccess(access.fingerprint, 'codex', {
      models: [{ id: 'gpt-live', label: 'GPT Live', isDefault: true, efforts: [] }],
      fastModeTierByModel: new Map([['gpt-live', 'priority-live-v2']]),
      origin: 'live-session'
    })
    const adapter = adapterFor(codex, { codexHome: '/codex/home' }, [], { modelCatalog })
    await adapter.acquire({
      identity: identityFor('session-1'),
      fence: 7,
      spawnToken: 'spawn-9',
      options: { fastMode: 'true' }
    })

    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-fast',
      body: USER_MESSAGE,
      fence: 7
    })

    expect(
      codex.connections[0].calls.find((call) => call.method === 'turn/start')?.params
    ).toMatchObject({ serviceTier: 'priority-live-v2' })
    expect(codex.connections[0].calls.some((call) => call.method === 'model/list')).toBe(false)
  })

  it('uses Standard on the first turn after acquisition with Fast explicitly off', async () => {
    const codex = fakeCodex()
    codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-standard')
    const adapter = adapterFor(codex)
    await adapter.acquire({
      identity: identityFor('session-1'),
      fence: 7,
      spawnToken: 'spawn-9',
      options: { fastMode: 'false' }
    })

    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-standard',
      body: USER_MESSAGE,
      fence: 7
    })

    expect(
      codex.connections[0].calls.find((call) => call.method === 'turn/start')?.params
    ).toMatchObject({ serviceTier: 'default' })
    expect(codex.connections[0].calls.some((call) => call.method === 'model/list')).toBe(false)
  })

  it('resolves a cold saved Fast tier on the first turn, after chat acquisition', async () => {
    const listing = Promise.withResolvers<{
      data: Record<string, unknown>[]
      nextCursor: null
    }>()
    const codex = fakeCodex({ 'model/list': () => listing.promise })
    codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-fast')
    const adapter = adapterFor(codex)
    await adapter.acquire({
      identity: identityFor('session-1'),
      fence: 7,
      spawnToken: 'spawn-9',
      options: { fastMode: 'true' }
    })
    expect(codex.connections[0].calls.map((call) => call.method)).toEqual(['thread/start'])
    expect(adapter.readAcquisitionOptions({ sessionId: 'session-1', fence: 7 })).toMatchObject({
      fastMode: 'true'
    })

    const sending = adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-fast',
      body: USER_MESSAGE,
      fence: 7
    })
    await vi.waitFor(() => {
      expect(codex.connections[0].calls.some((call) => call.method === 'model/list')).toBe(true)
    })
    expect(codex.connections[0].calls.some((call) => call.method === 'turn/start')).toBe(false)
    listing.resolve({
      data: [
        {
          model: 'gpt-live',
          supportedReasoningEfforts: [],
          serviceTiers: [{ id: 'priority-live-v2', name: 'Fast' }]
        }
      ],
      nextCursor: null
    })
    await sending
    expect(
      codex.connections[0].calls.find((call) => call.method === 'turn/start')?.params
    ).toMatchObject({ serviceTier: 'priority-live-v2' })
    await expect(adapter.readOptions({ sessionId: 'session-1', fence: 7 })).resolves.toMatchObject({
      fastModeSupport: { supported: true },
      current: { fastMode: true }
    })
  })

  it('uses this session’s listing for its first Fast turn while a probe is pending', async () => {
    const modelCatalog = new AgentModelCatalogStore()
    const access = agentModelCatalogSessionAccess(modelCatalog, 'codex', '/codex/home')!
    void modelCatalog.refresh(access.fingerprint, 'codex', () => new Promise<never>(() => {}))
    const codex = fakeCodex({
      'model/list': () => ({
        data: [
          {
            model: 'gpt-live',
            supportedReasoningEfforts: [],
            serviceTiers: [{ id: 'priority-own', name: 'Fast' }]
          }
        ],
        nextCursor: null
      })
    })
    codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-fast')
    const adapter = adapterFor(codex, { codexHome: '/codex/home' }, [], { modelCatalog })

    await adapter.acquire({
      identity: identityFor('session-1'),
      fence: 7,
      spawnToken: 'spawn-9',
      options: { fastMode: 'true' }
    })
    expect(codex.connections[0].calls.map((call) => call.method)).toEqual(['thread/start'])
    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-fast',
      body: USER_MESSAGE,
      fence: 7
    })

    expect(
      codex.connections[0].calls.find((call) => call.method === 'turn/start')?.params
    ).toMatchObject({ serviceTier: 'priority-own' })
  })

  it('resolves a saved legacy tier on the first turn without delaying acquisition', async () => {
    const codex = fakeCodex({
      'model/list': () => ({
        data: [
          {
            model: 'gpt-live',
            supportedReasoningEfforts: [],
            serviceTiers: [{ id: 'priority-legacy', name: 'Fast' }]
          }
        ],
        nextCursor: null
      })
    })
    codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-fast')
    const adapter = adapterFor(codex)
    await adapter.acquire({
      identity: identityFor('session-1'),
      fence: 7,
      spawnToken: 'spawn-9',
      options: { serviceTier: 'priority-legacy' }
    })

    expect(codex.connections[0].calls.map((call) => call.method)).toEqual(['thread/start'])
    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-fast',
      body: USER_MESSAGE,
      fence: 7
    })
    expect(
      codex.connections[0].calls.find((call) => call.method === 'turn/start')?.params
    ).toMatchObject({ serviceTier: 'priority-legacy' })
  })

  it('does not delay later turns after first-turn Fast discovery fails', async () => {
    const listModels = vi.fn(() => {
      throw new Error('catalog temporarily unavailable')
    })
    const codex = fakeCodex({ 'model/list': listModels })
    codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-standard')
    const adapter = adapterFor(codex)
    await adapter.acquire({
      identity: identityFor('session-1'),
      fence: 7,
      spawnToken: 'spawn-9',
      options: { fastMode: 'true' }
    })

    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-first',
      body: USER_MESSAGE,
      fence: 7
    })
    codex.connections[0].handlers.onNotification?.('turn/completed', {
      threadId: THREAD_ID,
      turn: { id: 'turn-standard', status: 'completed' }
    })
    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-second',
      body: USER_MESSAGE,
      fence: 7
    })

    expect(listModels).toHaveBeenCalledOnce()
    expect(
      codex.connections[0].calls
        .filter((call) => call.method === 'turn/start')
        .map((call) => call.params?.serviceTier)
    ).toEqual(['default', 'default'])
  })

  it.each(['absent', 'transient'] as const)(
    'uses Standard when first-turn Fast discovery is %s, then recovers the exact tier',
    async (discovery) => {
      const unavailableCatalog = () => {
        if (discovery === 'transient') {
          throw new Error('catalog temporarily unavailable')
        }
        return {
          data: [{ model: 'gpt-live', supportedReasoningEfforts: [] }],
          nextCursor: null
        }
      }
      const listModels = vi.fn<Route>().mockImplementationOnce(unavailableCatalog)
      listModels.mockImplementationOnce(unavailableCatalog)
      listModels.mockImplementation(() => ({
        data: [
          {
            model: 'gpt-live',
            supportedReasoningEfforts: [],
            serviceTiers: [{ id: 'priority-recovered', name: 'Fast' }]
          }
        ],
        nextCursor: null
      }))
      const codex = fakeCodex({ 'model/list': listModels })
      codex.routes['turn/start'] = answerWithOpenedTurn(codex, 'turn-recovered')
      const adapter = adapterFor(codex)
      await expect(
        adapter.acquire({
          identity: identityFor('session-1'),
          fence: 7,
          spawnToken: 'spawn-9',
          options: { fastMode: 'true' }
        })
      ).resolves.toBeDefined()

      await expect(
        adapter.dispatch({
          sessionId: 'session-1',
          clientMessageId: 'client-unverified',
          body: USER_MESSAGE,
          fence: 7
        })
        // `admitted`, not `accepted`: a Codex send now settles its identity on
        // the provider echo. What this test pins is the tier the turn carries.
      ).resolves.toMatchObject({ state: 'admitted' })
      expect(
        codex.connections[0].calls.find((call) => call.method === 'turn/start')?.params
      ).toMatchObject({ serviceTier: 'default' })

      if (discovery === 'transient') {
        await expect(adapter.readOptions({ sessionId: 'session-1', fence: 7 })).rejects.toThrow(
          'catalog temporarily unavailable'
        )
      } else {
        const unavailable = await adapter.readOptions({ sessionId: 'session-1', fence: 7 })
        expect(unavailable).toMatchObject({ current: { fastMode: true } })
        expect(unavailable.fastModeSupport).toBeUndefined()
        expect(unavailable.models[0]?.supportsFastMode).toBeUndefined()
      }
      const options = await adapter.readOptions({ sessionId: 'session-1', fence: 7 })
      expect(options).toMatchObject({
        models: [expect.objectContaining({ supportsFastMode: true })],
        fastModeSupport: { supported: true },
        current: { fastMode: true }
      })
      // Ended, so the next send starts a turn rather than steering into this one.
      codex.connections[0].handlers.onNotification?.('turn/completed', {
        threadId: THREAD_ID,
        turn: { id: 'turn-recovered', status: 'completed' }
      })
      await adapter.dispatch({
        sessionId: 'session-1',
        clientMessageId: 'client-recovered',
        body: USER_MESSAGE,
        fence: 7
      })
      expect(
        codex.connections[0].calls.filter((call) => call.method === 'turn/start')[1]?.params
      ).toMatchObject({ serviceTier: 'priority-recovered' })
    }
  )
})
