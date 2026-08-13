export const COMFY_CONNECTION_SETTING_KEY = 'comfyConnection'
export const COMFY_CONNECTION_LOCAL_KEY = 'comfystudio-comfy-connection'
export const COMFY_CONNECTION_CHANGED_EVENT = 'comfystudio-comfy-connection-changed'

export const LOCAL_COMFY_HOST = '127.0.0.1'
export const DEFAULT_COMFY_PORT = 8188
export const DEFAULT_COMFY_HTTP_BASE = `http://${LOCAL_COMFY_HOST}:${DEFAULT_COMFY_PORT}`

let cachedConnection = buildConnection(DEFAULT_COMFY_HTTP_BASE)
let hydrated = false
let hydrationPromise = null
let connectionVersion = 0

function normalizePort(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  if (parsed < 1 || parsed > 65535) return null
  return parsed
}

function buildWsBase(httpBase) {
  return String(httpBase).replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
}

function normalizeHttpBase(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return DEFAULT_COMFY_HTTP_BASE

  let candidate = raw
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    candidate = `http://${candidate}`
  }

  const parsed = new URL(candidate)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Use an http:// or https:// ComfyUI endpoint.')
  }
  if (parsed.username || parsed.password) {
    throw new Error('ComfyUI endpoint URLs must not contain credentials.')
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('ComfyUI endpoint must point to the server root.')
  }
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function buildConnection(value) {
  const httpBase = normalizeHttpBase(value)
  const parsed = new URL(httpBase)
  const port = normalizePort(parsed.port || DEFAULT_COMFY_PORT) || DEFAULT_COMFY_PORT
  return {
    host: parsed.hostname,
    port,
    httpBase,
    wsBase: buildWsBase(httpBase),
    isRemote: !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase()),
  }
}

function readStoredConnection() {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(COMFY_CONNECTION_LOCAL_KEY)
    if (!raw) return null
    return parseStoredConnection(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeStoredConnection(config) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(COMFY_CONNECTION_LOCAL_KEY, JSON.stringify({ httpBase: config.httpBase }))
  } catch {
    // Ignore storage write failures.
  }
}

function dispatchConnectionChanged(config) {
  try {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
    window.dispatchEvent(new CustomEvent(COMFY_CONNECTION_CHANGED_EVENT, { detail: config }))
  } catch {
    // Ignore event dispatch failures.
  }
}

function parseStoredConnection(raw) {
  if (raw && typeof raw === 'object') {
    if (raw.httpBase) {
      try { return { success: true, config: buildConnection(raw.httpBase) } } catch { return { success: false } }
    }
    if (raw.url) {
      try { return { success: true, config: buildConnection(raw.url) } } catch { return { success: false } }
    }
    if (raw.host && raw.port) {
      try { return { success: true, config: buildConnection(`http://${raw.host}:${raw.port}`) } } catch { return { success: false } }
    }
    if (raw.port !== undefined) {
      try { return { success: true, config: buildConnection(`http://${LOCAL_COMFY_HOST}:${raw.port}`) } } catch { return { success: false } }
    }
  }
  if (typeof raw === 'number' || typeof raw === 'string') {
    try { return { success: true, config: buildConnection(String(raw)) } } catch { return { success: false } }
  }
  return { success: false }
}

function hydrateFromLocalStorage() {
  const stored = readStoredConnection()
  if (stored?.success) cachedConnection = stored.config
}

hydrateFromLocalStorage()

export function parseLocalComfyPortInput(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return { success: true, config: buildConnection(DEFAULT_COMFY_HTTP_BASE), port: DEFAULT_COMFY_PORT }

  try {
    const config = buildConnection(/^\d+$/.test(raw) ? `http://${LOCAL_COMFY_HOST}:${raw}` : raw)
    return { success: true, config, port: config.port }
  } catch (err) {
    return { success: false, error: err?.message || 'Invalid ComfyUI endpoint.' }
  }
}

export function isLoopbackHttpUrl(value) {
  try {
    const hostname = new URL(String(value || '')).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

export function getLocalComfyConnectionSync() {
  return cachedConnection
}

export function getLocalComfyHttpBaseSync() {
  return cachedConnection.httpBase
}

export function getLocalComfyWsBaseSync() {
  return cachedConnection.wsBase
}

export async function hydrateLocalComfyConnection() {
  if (hydrated) return cachedConnection
  if (hydrationPromise) return hydrationPromise

  hydrationPromise = (async () => {
    const startVersion = connectionVersion
    hydrateFromLocalStorage()

    if (typeof window !== 'undefined' && window?.electronAPI?.getSetting) {
      try {
        const stored = await window.electronAPI.getSetting(COMFY_CONNECTION_SETTING_KEY)
        let parsed = parseStoredConnection(stored)

        if (!parsed.success) {
          const legacyUrl = await window.electronAPI.getSetting('comfyUrl')
          parsed = parseStoredConnection(legacyUrl)
        }

        if (parsed.success && startVersion === connectionVersion) {
          cachedConnection = parsed.config
          writeStoredConnection(cachedConnection)
        }
      } catch {
        // Keep the local/default value if settings cannot be read.
      }
    }

    hydrated = true
    const config = cachedConnection
    hydrationPromise = null
    return config
  })()

  return hydrationPromise
}

export async function saveLocalComfyConnectionPort(input) {
  const parsed = parseLocalComfyPortInput(input)
  if (!parsed.success) return { success: false, error: parsed.error }

  connectionVersion += 1
  cachedConnection = parsed.config
  writeStoredConnection(cachedConnection)

  try {
    if (typeof window !== 'undefined' && window?.electronAPI?.setSetting) {
      await window.electronAPI.setSetting(COMFY_CONNECTION_SETTING_KEY, {
        host: cachedConnection.host,
        port: cachedConnection.port,
        httpBase: cachedConnection.httpBase,
        wsBase: cachedConnection.wsBase,
      })
    }
  } catch (err) {
    return { success: false, error: err?.message || 'Failed to persist ComfyUI setting.' }
  }

  dispatchConnectionChanged(cachedConnection)
  return { success: true, config: cachedConnection }
}

export async function checkLocalComfyConnection(options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 4500
  let config = cachedConnection

  if (options.port !== undefined) {
    const parsed = parseLocalComfyPortInput(options.port)
    if (!parsed.success) return { ok: false, error: parsed.error }
    config = parsed.config
  } else if (options.endpoint || options.url) {
    const parsed = parseLocalComfyPortInput(options.endpoint || options.url)
    if (!parsed.success) return { ok: false, error: parsed.error }
    config = parsed.config
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = setTimeout(() => controller?.abort(), timeoutMs)

  try {
    const response = await fetch(`${config.httpBase}/system_stats`, { signal: controller?.signal })
    if (response.ok) {
      return { ok: true, status: response.status, httpBase: config.httpBase, port: config.port, source: 'renderer' }
    }
    return {
      ok: false,
      status: response.status,
      httpBase: config.httpBase,
      port: config.port,
      error: response.status === 403
        ? 'ComfyUI returned HTTP 403. Enable CORS on the remote ComfyUI server.'
        : `ComfyUI returned HTTP ${response.status}.`,
    }
  } catch (err) {
    return {
      ok: false,
      httpBase: config.httpBase,
      port: config.port,
      error: err?.name === 'AbortError'
        ? `Timed out connecting to ${config.httpBase}.`
        : `Could not connect to ${config.httpBase}: ${err?.message || 'Unknown error'}`,
    }
  } finally {
    clearTimeout(timer)
  }
}
