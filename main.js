// comfyui API

class ComfyApi extends EventTarget {
  #registered = new Set()

  constructor () {
    super()
    this.api_host = location.host
    this.api_base = location.pathname.split('/').slice(0, -1).join('/')
    this.protocol = location.protocol
  }

  apiURL (route) {
    return this.api_base + route
  }

  fetchApi (route, options) {
    if (!options) {
      options = {}
    }
    if (!options.headers) {
      options.headers = {}
    }
    options.headers['Comfy-User'] = this.user
    return fetch(this.apiURL(route), options)
  }

  addEventListener (type, callback, options) {
    super.addEventListener(type, callback, options)
    this.#registered.add(type)
  }

  /**
   * Poll status  for colab and other things that don't support websockets.
   */
  #pollQueue () {
    this._pollQueueInterval = setInterval(async () => {
      try {
        const resp = await this.fetchApi('/prompt')
        const status = await resp.json()
        this.dispatchEvent(new CustomEvent('status', { detail: status }))
      } catch (error) {
        this.dispatchEvent(new CustomEvent('status', { detail: null }))
      }
    }, 1000)
  }

  /**
   * Creates and connects a WebSocket for realtime updates
   * @param {boolean} isReconnect If the socket is connection is a reconnect attempt
   */
  #createSocket (isReconnect) {
    if (this.socket) {
      return
    }

    let opened = false
    let existingSession = window.name || ''
    if (existingSession) {
      existingSession = '?clientId=' + existingSession
    }
    this.socket = new WebSocket(
      `ws${this.protocol === 'https:' ? 's' : ''}://${this.api_host}${
        this.api_base
      }/ws${existingSession}`
    )
    console.log(
      `ws${this.protocol === 'https:' ? 's' : ''}://${this.api_host}${
        this.api_base
      }/ws${existingSession}`
    )
    this.socket.binaryType = 'arraybuffer'

    this.socket.addEventListener('open', () => {
      opened = true
      if (isReconnect) {
        this.dispatchEvent(new CustomEvent('reconnected'))
      }
    })

    this.socket.addEventListener('error', () => {
      this.socket = null
      this.dispatchEvent(new CustomEvent('status', { detail: null }))
      // try {
      //   if (this.socket) {
      //     this.socket.close()
      //   }
      //   if (!isReconnect && !opened) {
      //     // this.#pollQueue()
      //   }
      // } catch (error) {
      //   console.log('error',error)
      //   this.socket=null;
      //   this.dispatchEvent(new CustomEvent('status', { detail: null }));

      // }
    })

    this.socket.addEventListener('close', () => {
      console.log('close', this.socket)
      if (this.socket) {
        setTimeout(() => {
          this.socket = null
          this.#createSocket(true)
        }, 300)
      }

      if (opened) {
        this.dispatchEvent(new CustomEvent('status', { detail: null }))
        this.dispatchEvent(new CustomEvent('reconnecting'))
      }
    })

    this.socket.addEventListener('message', event => {
      try {
        if (event.data instanceof ArrayBuffer) {
          const view = new DataView(event.data)
          const eventType = view.getUint32(0)
          const buffer = event.data.slice(4)
          switch (eventType) {
            case 1:
              const view2 = new DataView(event.data)
              const imageType = view2.getUint32(0)
              let imageMime
              switch (imageType) {
                case 1:
                default:
                  imageMime = 'image/jpeg'
                  break
                case 2:
                  imageMime = 'image/png'
              }
              const imageBlob = new Blob([buffer.slice(4)], { type: imageMime })
              this.dispatchEvent(
                new CustomEvent('b_preview', { detail: imageBlob })
              )
              break
            default:
              throw new Error(
                `Unknown binary websocket message of type ${eventType}`
              )
          }
        } else {
          const msg = JSON.parse(event.data)
          switch (msg.type) {
            case 'status':
              if (msg.data.sid) {
                this.clientId = msg.data.sid
                window.name = this.clientId
              }
              this.dispatchEvent(
                new CustomEvent('status', { detail: msg.data.status })
              )
              break
            case 'progress':
              this.dispatchEvent(
                new CustomEvent('progress', { detail: msg.data })
              )
              break
            case 'executing':
              this.dispatchEvent(
                new CustomEvent('executing', { detail: msg.data.node })
              )
              break
            case 'executed':
              this.dispatchEvent(
                new CustomEvent('executed', { detail: msg.data })
              )
              break
            case 'execution_start':
              this.dispatchEvent(
                new CustomEvent('execution_start', { detail: msg.data })
              )
              break
            case 'execution_error':
              this.dispatchEvent(
                new CustomEvent('execution_error', { detail: msg.data })
              )
              break
            case 'execution_cached':
              this.dispatchEvent(
                new CustomEvent('execution_cached', { detail: msg.data })
              )
              break
            default:
              if (this.#registered.has(msg.type)) {
                this.dispatchEvent(
                  new CustomEvent(msg.type, { detail: msg.data })
                )
              } else {
                throw new Error(`Unknown message type ${msg.type}`)
              }
          }
        }
      } catch (error) {
        console.warn('Unhandled message:', event.data, error)
      }
    })
  }

  /**
   * Initialises sockets and realtime updates
   */
  init () {
    // console.log('#init',this.protocol,this.api_host)
    this.#createSocket()
  }

  /**
   * Gets a list of extension urls
   * @returns An array of script urls to import
   */
  async getExtensions () {
    const resp = await this.fetchApi('/extensions', { cache: 'no-store' })
    return await resp.json()
  }

  /**
   * Gets a list of embedding names
   * @returns An array of script urls to import
   */
  async getEmbeddings () {
    const resp = await this.fetchApi('/embeddings', { cache: 'no-store' })
    return await resp.json()
  }

  /**
   * Loads node object definitions for the graph
   * @returns The node definitions
   */
  async getNodeDefs () {
    const resp = await this.fetchApi('/object_info', { cache: 'no-store' })
    return await resp.json()
  }

  /**
   *
   * @param {number} number The index at which to queue the prompt, passing -1 will insert the prompt at the front of the queue
   * @param {object} prompt The prompt data to queue
   */
  async queuePrompt (number, { output, workflow }) {
    const body = {
      client_id: this.clientId,
      prompt: output,
      extra_data: { extra_pnginfo: { workflow } }
    }

    if (number === -1) {
      body.front = true
    } else if (number != 0) {
      body.number = number
    }

    const res = await this.fetchApi('/prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (res.status !== 200) {
      throw {
        response: await res.json()
      }
    }

    return await res.json()
  }

  /**
   * Loads a list of items (queue or history)
   * @param {string} type The type of items to load, queue or history
   * @returns The items of the specified type grouped by their status
   */
  async getItems (type) {
    if (type === 'queue') {
      return this.getQueue()
    }
    return this.getHistory()
  }

  /**
   * Gets the current state of the queue
   * @returns The currently running and queued items
   */
  async getQueue () {
    try {
      const res = await this.fetchApi('/queue')
      const data = await res.json()
      return {
        // Running action uses a different endpoint for cancelling
        Running: data.queue_running.map(prompt => ({
          prompt,
          remove: { name: 'Cancel', cb: () => api.interrupt() }
        })),
        Pending: data.queue_pending.map(prompt => ({ prompt }))
      }
    } catch (error) {
      console.error(error)
      return { Running: [], Pending: [] }
    }
  }

  /**
   * Gets the prompt execution history
   * @returns Prompt history including node outputs
   */
  async getHistory (max_items = 200) {
    try {
      const res = await this.fetchApi(`/history?max_items=${max_items}`)
      return { History: Object.values(await res.json()) }
    } catch (error) {
      console.error(error)
      return { History: [] }
    }
  }

  /**
   * Gets system & device stats
   * @returns System stats such as python version, OS, per device info
   */
  async getSystemStats () {
    const res = await this.fetchApi('/system_stats')
    return await res.json()
  }

  /**
   * Sends a POST request to the API
   * @param {*} type The endpoint to post to
   * @param {*} body Optional POST data
   */
  async #postItem (type, body) {
    try {
      await this.fetchApi('/' + type, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      })
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Deletes an item from the specified list
   * @param {string} type The type of item to delete, queue or history
   * @param {number} id The id of the item to delete
   */
  async deleteItem (type, id) {
    await this.#postItem(type, { delete: [id] })
  }

  /**
   * Clears the specified list
   * @param {string} type The type of list to clear, queue or history
   */
  async clearItems (type) {
    await this.#postItem(type, { clear: true })
  }

  /**
   * Interrupts the execution of the running prompt
   */
  async interrupt () {
    await this.#postItem('interrupt', null)
  }

  /**
   * Gets user configuration data and where data should be stored
   * @returns { Promise<{ storage: "server" | "browser", users?: Promise<string, unknown>, migrated?: boolean }> }
   */
  async getUserConfig () {
    return (await this.fetchApi('/users')).json()
  }

  /**
   * Creates a new user
   * @param { string } username
   * @returns The fetch response
   */
  createUser (username) {
    return this.fetchApi('/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username })
    })
  }

  /**
   * Gets all setting values for the current user
   * @returns { Promise<string, unknown> } A dictionary of id -> value
   */
  async getSettings () {
    return (await this.fetchApi('/settings')).json()
  }

  /**
   * Gets a setting for the current user
   * @param { string } id The id of the setting to fetch
   * @returns { Promise<unknown> } The setting value
   */
  async getSetting (id) {
    return (await this.fetchApi(`/settings/${encodeURIComponent(id)}`)).json()
  }

  /**
   * Stores a dictionary of settings for the current user
   * @param { Record<string, unknown> } settings Dictionary of setting id -> value to save
   * @returns { Promise<void> }
   */
  async storeSettings (settings) {
    return this.fetchApi(`/settings`, {
      method: 'POST',
      body: JSON.stringify(settings)
    })
  }

  /**
   * Stores a setting for the current user
   * @param { string } id The id of the setting to update
   * @param { unknown } value The value of the setting
   * @returns { Promise<void> }
   */
  async storeSetting (id, value) {
    return this.fetchApi(`/settings/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify(value)
    })
  }

  /**
   * Gets a user data file for the current user
   * @param { string } file The name of the userdata file to load
   * @param { RequestInit } [options]
   * @returns { Promise<unknown> } The fetch response object
   */
  async getUserData (file, options) {
    return this.fetchApi(`/userdata/${encodeURIComponent(file)}`, options)
  }

  /**
   * Stores a user data file for the current user
   * @param { string } file The name of the userdata file to save
   * @param { unknown } data The data to save to the file
   * @param { RequestInit & { stringify?: boolean, throwOnError?: boolean } } [options]
   * @returns { Promise<void> }
   */
  async storeUserData (
    file,
    data,
    options = { stringify: true, throwOnError: true }
  ) {
    const resp = await this.fetchApi(`/userdata/${encodeURIComponent(file)}`, {
      method: 'POST',
      body: options?.stringify ? JSON.stringify(data) : data,
      ...options
    })
    if (resp.status !== 200) {
      throw new Error(
        `Error storing user data file '${file}': ${resp.status} ${
          (await resp).statusText
        }`
      )
    }
  }
}

const { entrypoints } = require('uxp')
const { localFileSystem: fs, fileTypes, formats } = require('uxp').storage
const photoshop = require('photoshop').app
// const imaging = require('photoshop').imaging //此api不存在
const { executeAsModal } = require('photoshop').core
const batchPlay = require('photoshop').action.batchPlay

const Jimp = require('./lib/jimp.min.js')

const base64Df =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAYAAABWdVznAAAAAXNSR0IArs4c6QAAALZJREFUKFOFkLERwjAQBPdbgBkInECGaMLUQDsE0AkRVRAYWqAByxldPPOWHwnw4OBGye1p50UDSoA+W2ABLPN7i+C5dyC6R/uiAUXRQCs0bXoNIu4QPQzAxDKxHoALOrZcqtiyR/T6CXw7+3IGHhkYcy6BOR2izwT8LptG8rbMiCRAUb+CQ6WzQVb0SNOi5Z2/nX35DRyb/ENazhpWKoGwrpD6nICp5c2qogc4of+c7QcrhgF4Aa/aoAFHiL+RAAAAAElFTkSuQmCC'

// 当前的workflow
window.app = null

let hostUrl = 'http://127.0.0.1:8188'

function createSetup (parentElement) {
  let heading = document.createElement('sp-heading')
  heading.innerHTML = `<span class="status"></span>`

  parentElement.appendChild(heading)

  const [div, textInput] = createTextInput('Host Url', hostUrl, true)
  parentElement.appendChild(div)

  textInput.addEventListener('change', e => {
    hostUrl = textInput.value
    const appDom = document.getElementById('apps')
    appDom.innerText = ''
    const mainDom = document.getElementById('main')
    mainDom.innerText = ''

    if (window.api?._pollQueueInterval)
      clearInterval(window.api._pollQueueInterval)
    window.api = null
    btn.style.background = 'normal'
  })

  let footer = document.createElement('footer')
  parentElement.appendChild(footer)

  let btn = document.createElement('sp-button')

  btn.innerText = 'Load ComfyUI App'

  btn.addEventListener('click', () => {
    btn.style.background = 'darkblue'
    showAppsNames()
    // setTimeout(()=>btn.style.background='normal',1500)
  })

  footer.appendChild(btn)
}

function handleFlyout (id) {
  if (id === 'about') {
    document.querySelector('dialog').showModal()
  }
}

entrypoints.setup({
  panels: {
    mixlab_app: {
      show (node) {
        // console.log(node)
      }
    },
    setup: {
      show (node) {
        createSetup(node)
        // console.log(node)
      }
    }
    // menuItems: [
    //   {id: "about", label: "about"},
    //   // {id: "mixlab_app", label: "Mixlab App"},
    // ],
    // invokeMenu(id) {
    //   handleFlyout(id);
    // }
  }
})

async function arrayBufferToFile (arrayBuffer, image_name = 'output_image.png') {
  // const img = _base64ToArrayBuffer(b64Image)
  const img = arrayBuffer

  const img_name = image_name

  const folder = await fs.getTemporaryFolder()
  const file = await folder.createFile(img_name, { overwrite: true })

  await file.write(img, { format: formats.binary })

  const token = await fs.createSessionToken(file) // batchPlay requires a token on _path

  let place_event_result
  let imported_layer
  await executeAsModal(async () => {
    const result = await batchPlay(
      [
        {
          _obj: 'placeEvent',
          // ID: 6,
          null: {
            _path: token,
            _kind: 'local'
          },
          freeTransformCenterState: {
            _enum: 'quadCenterState',
            _value: 'QCSAverage'
          },
          offset: {
            _obj: 'offset',
            horizontal: {
              _unit: 'pixelsUnit',
              _value: 0
            },
            vertical: {
              _unit: 'pixelsUnit',
              _value: 0
            }
          },
          _isCommand: true,
          _options: {
            dialogOptions: 'dontDisplay'
          }
        }
      ],
      {
        synchronousExecution: true,
        modalBehavior: 'execute'
      }
    )
    console.log('placeEmbedd batchPlay result: ', result)

    place_event_result = result[0]
    imported_layer = await photoshop.activeDocument.activeLayers[0]
  })
  return imported_layer

  // return place_event_result
}

// 创建下拉选择
function createSelect (options, defaultValue) {
  var selectElement = document.createElement('select')
  selectElement.className = 'select'

  // 循环遍历选项数组
  for (var i = 0; i < options.length; i++) {
    var option = document.createElement('option')
    option.value = options[i].value
    option.innerText = options[i].text
    selectElement.appendChild(option)
    // if(options[i].selected)
  }

  // 设置默认值
  selectElement.value = defaultValue
  // console.log(defaultValue, options)
  return selectElement
}

// 创建下拉选择 - 带说明
function createSelectWithOptions (title, options, defaultValue) {
  const div = document.createElement('div')
  div.className = 'card'

  // Create a label for the upload control
  const nameLabel = document.createElement('label')
  nameLabel.textContent = title
  div.appendChild(nameLabel)

  var selectElement = createSelect(options, defaultValue)

  div.appendChild(selectElement)

  return [div, selectElement]
}

// 创建图片输入 - 带说明
function createImageInput (title, defaultValue) {
  const div = document.createElement('div')
  div.className = 'card'

  // Create a label for the upload control
  const nameLabel = document.createElement('label')
  nameLabel.textContent = title
  div.appendChild(nameLabel)

  // Create an input field for the image name
  const imgInput = document.createElement('img')
  imgInput.src = base64Df
  imgInput.className = 'input_image'
  // imgInput.src = `${hostUrl}/view?filename=${encodeURIComponent(
  //   defaultValue
  // )}&type=input&rand=${Math.random()}`

  div.appendChild(imgInput)

  return [div, imgInput]
}

// 创建文本输入 - 带说明
function createTextInput (title, defaultValue, isSingle = false) {
  // Create a container for the upload control
  const div = document.createElement('div')
  div.className = 'card'

  // Create a label for the upload control
  const nameLabel = document.createElement('label')
  nameLabel.textContent = title
  div.appendChild(nameLabel)

  // Create an input field for the image name
  const textInput = document.createElement('textarea')
  textInput.value = defaultValue

  if (isSingle) {
    textInput.style.height = '44px'
  }

  div.appendChild(textInput)

  // fixbug ，按backspace的时候，会删除图层
  textInput.addEventListener('focus', async e => {
    lockedCurrentLayerForTextInput()
  })

  textInput.addEventListener('blur', async e => {
    unLockedCurrentLayerForTextInput()
  })

  return [div, textInput]
}

// 数字输入
function createNumberSelectInput (title, defaultValue, opts) {
  const { step, min, max } = opts

  // const [div, numInput] = createSelectWithOptions(
  //   title,
  //   Array.from(new Array((max - min) / step), (a, i) => {
  //     return {
  //       text: (i + 1) * step,
  //       value: (i + 1) * step
  //     }
  //   }),
  //   defaultValue
  // )

  const div = document.createElement('div')
  div.className = 'card'

  // Create a label for the upload control
  const nameLabel = document.createElement('label')
  nameLabel.textContent = title
  div.appendChild(nameLabel)

  // Create an input field for the image name
  const numInput = document.createElement('input')
  numInput.type = 'range'
  numInput.value = defaultValue
  numInput.min = min || 0
  numInput.max = max || 255
  numInput.step = String(step || 1)

  div.appendChild(numInput)

  const value = document.createElement('label')
  value.innerText = defaultValue

  numInput.addEventListener('change', e => {
    value.innerText = numInput.value
  })

  div.appendChild(value)

  return [div, numInput]
}

// 种子的处理
function randomSeed (seed, data) {
  for (const id in data) {
    if (
      data[id].inputs.seed != undefined &&
      !Array.isArray(data[id].inputs.seed) && //如果是数组，则由其他节点控制
      ['increment', 'decrement', 'randomize'].includes(seed[id])
    ) {
      data[id].inputs.seed = Math.round(Math.random() * 1849378600828930)
      // console.log('new Seed', data[id])
    }
    if (
      data[id].inputs.noise_seed != undefined &&
      !Array.isArray(data[id].inputs.noise_seed) && //如果是数组，则由其他节点控制
      ['increment', 'decrement', 'randomize'].includes(seed[id])
    ) {
      data[id].inputs.noise_seed = Math.round(Math.random() * 1849378600828930)
    }
    console.log('new Seed', data[id])
  }
  return data
}

async function getMyApps (
  hostUrl,
  category = '',
  filename = null,
  admin = false
) {
  let url = hostUrl
  const res = await fetch(`${url}/mixlab/workflow`, {
    method: 'POST',
    body: JSON.stringify({
      task: 'my_app',
      filename,
      category,
      admin
    })
  })
  let result = await res.json()
  let data = []
  try {
    for (const res of result.data) {
      let { output, app } = res.data
      if (app.filename)
        data.push({
          ...app,
          data: output,
          date: res.date
        })
    }
  } catch (error) {}
  return data
}

// TODO ps插件不支持File类型，需要调整
async function uploadImage (arrayBuffer, fileType = '.png', filename) {
  const body = new FormData()

  const fileName = (filename || new Date().getTime()) + fileType
  // 直接传
  body.append('image', arrayBuffer, fileName)

  const url = hostUrl

  const resp = await fetch(`${url}/upload/image`, {
    method: 'POST',
    body
  })

  // console.log(resp)
  let data = await resp.json()
  let { name, subfolder } = data
  let src = `${url}/view?filename=${encodeURIComponent(
    name
  )}&type=input&subfolder=${subfolder}&rand=${Math.random()}`

  return { url: src, name }
}

function runMyApp (url, data) {
  fetch(`${url}/prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: data
  })
    .then(response => {
      // Handle response here
      console.log(response)
    })
    .catch(error => {
      // Handle error here
    })
}

// 取消选择
async function unselectActiveLayers () {
  const layers = await photoshop.activeDocument.activeLayers
  for (layer of layers) {
    layer.selected = false
  }
}
async function unselectActiveLayersExe () {
  await executeAsModal(async () => {
    await unselectActiveLayers()
  })
}
async function selectLayers (layers) {
  await unselectActiveLayers()
  for (layer of layers) {
    try {
      if (layer) {
        const is_visible = layer.visible // don't change the visibility when selecting the layer
        layer.selected = true
        layer.visible = is_visible
      }
    } catch (e) {
      console.warn(e)
    }
  }
}

async function selectLayersExe (layers) {
  await executeAsModal(async () => {
    await selectLayers(layers)
  })
}

async function lockedCurrentLayerForTextInput () {
  window._layersLocked = []

  for (layer of photoshop.activeDocument.activeLayers) {
    try {
      if (layer) {
        window._layersLocked.push({
          _id: layer._id,
          locked: layer.locked
        })
        layer.locked = true
      }
    } catch (e) {
      console.warn(e)
    }
  }
}

function unLockedCurrentLayerForTextInput () {
  // window._layersLocked = []
  for (layer of photoshop.activeDocument.layers) {
    try {
      if (
        window._layersLocked &&
        window._layersLocked.filter(l => l._id === layer._id)[0]
      ) {
        let l = window._layersLocked.filter(l => l._id === layer._id)[0]
        layer.locked = l.locked
      }
    } catch (e) {
      console.warn(e)
    }
  }
}

// 选区范围

async function getSelectionInfoCommand () {
  // console.warn('getSelectionInfoCommand is deprecated use SelectionInfoDesc')
  const result = await batchPlay(
    [
      {
        _obj: 'get',
        _target: [
          {
            _property: 'selection'
          },
          {
            _ref: 'document',
            _id: photoshop.activeDocument._id
          }
        ],
        _options: {
          dialogOptions: 'dontDisplay'
        }
      }
    ],
    {
      synchronousExecution: true,
      modalBehavior: 'execute'
    }
  )

  return result
}

function isSelectionValid (selection) {
  // console.warn(
  //     'isSelectionValid is deprecated use selection.isSelectionValid instead'
  // )
  if (
    selection && // check if the selection is defined
    selection.hasOwnProperty('left') &&
    selection.hasOwnProperty('right') &&
    selection.hasOwnProperty('top') &&
    selection.hasOwnProperty('bottom')
  ) {
    return true
  }

  return false
}

// 获取选区范围
async function getSelectionInfoExe () {
  // console.log('getSelectionInfo was called')
  // console.warn(
  //     'getSelectionInfoExe is deprecated use selection.getSelectionInfoExe instead'
  // )
  try {
    const selection = (await executeAsModal(getSelectionInfoCommand))[0]
      .selection

    if (isSelectionValid(selection)) {
      let selection_info = {
        left: selection.left._value,
        right: selection.right._value,
        bottom: selection.bottom._value,
        top: selection.top._value,
        height: selection.bottom._value - selection.top._value,
        width: selection.right._value - selection.left._value
      }
      // console.dir({selection_info})
      return selection_info
    }
  } catch (e) {
    console.warn('selection info error', e)
  }
}

async function getImageFromLayerByBound () {
  // 选区
  let bound = await getSelectionInfoExe()
  if (bound == undefined) return { base64: null, buffer: null }
  // 取base64 ，上传
  let file
  try {
    const folder = await fs.getTemporaryFolder()
    await executeAsModal(
      async () => {
        const canvas_image_name = 'input_image.png'
        file = await folder.createFile(canvas_image_name, {
          overwrite: true
        })

        const currentDocument = photoshop.activeDocument
        await currentDocument.save(file, formats.PNG)
        //save file end

        //read the saved image.png
      },

      { commandName: 'readPng' }
    )
  } catch (error) {
    console.log(error)
  }

  // console.log(file)
  const arrayBuffer = await file.read({
    format: formats.binary
  })

  // const { url, name } = await uploadImage(arrayBuffer)

  // console.log(arrayBuffer)
  // return { url, name }

  const im = await Jimp.read(arrayBuffer)
  let cropped_img = await im.crop(
    bound.left,
    bound.top,
    bound.width,
    bound.height
  )
  let base64 = await cropped_img.getBase64Async(Jimp.MIME_PNG)
  let buffer = await cropped_img.getBufferAsync(Jimp.MIME_PNG)
  return { base64, buffer }
}

// 读取url里的图片，并粘贴到ps里
async function downloadIt (link) {
  const res = await fetch(link)
  console.log(link)

  try {
    const img = await res.arrayBuffer()
    const temp = await fs.getTemporaryFolder()
    // const file = await fs.getFileForSaving("image.png");
    let fileName = 'image.png'
    const image = await temp.createFile(fileName, { overwrite: true })
    // await image.delete()

    await image.write(img, { format: formats.binary })

    // await file.write(img);
    const currentDocument = photoshop.activeDocument
    // let newLayer = await currentDocument.layers.add();

    const newDocument = await photoshop.open(image)
    let new_layer
    if (currentDocument) {
      new_layer = await newDocument.activeLayers[0].duplicate(currentDocument)
      // await newDocument.close()
      await newDocument.closeWithoutSaving()
    }

    // 删除
    await image.delete()

    return new_layer
  } catch (e) {
    console.log(e)
  }
}

async function downloadItExe (link) {
  let new_layer
  await executeAsModal(async () => {
    try {
      new_layer = await downloadIt(link)
    } catch (e) {
      console.warn(e)
    }
  })
  return new_layer
}

async function addImageFromUrl (link) {
  const res = await fetch(link)

  const img = await res.arrayBuffer()

  let imageName = 'output.png'
  // for (let index = 0; index < window.app.input.length; index++) {
  //   const inp = app.input[index]
  //   if (inp.inputs?.text) {
  //     imageName+=`_${inp.title}_${window.app.data[inp.id].inputs.text.slice(0,10)}`
  //   }
  // }
  // imageName=imageName?(imageName+'.png'):'output.png'
  // console.log(imageName)
  await arrayBufferToFile(img, imageName)
}

async function show (src, id, type = 'image') {
  console.log('#show', type, id, src)

  if (src && type == 'image') {
    await addImageFromUrl(src)
  }

  if (src && (type == 'images' || type == 'images_prompts')) {
    for (const v of src) {
      let url = v,
        prompt = ''

      if (type == 'images_prompts') {
        // 是个数组，多了对应的prompt
        url = v[0]
        prompt = v[1]
      }

      await addImageFromUrl(url)
    }
  }
}

function createApp (apps, targetFilename, mainDom) {
  window.app = apps.filter(ap => ap.filename === targetFilename)[0]
  // console.log(app,api.clientId)
  const app = window.app

  mainDom.innerHTML = ''

  // 输入和输出的ui创建

  // 图片输入
  for (let index = 0; index < app.input.length; index++) {
    const inp = app.input[index]
    // 节点可能不存在
    if (inp?.inputs?.image && ['LoadImage'].includes(inp.class_type)) {
      const [div, imgInput] = createImageInput(inp.title, inp.inputs.image)
      mainDom.appendChild(div)

      // 点击后从当前选区获取图片
      imgInput.addEventListener('click', async e => {
        // console.log('mouserover')
        const { base64, buffer } = await getImageFromLayerByBound()
        if (base64 === null) {
          // 没有选择选区
          photoshop.showAlert(`Please select the region`)
          return
        }
        if (base64 != imgInput.src) {
          imgInput.src = base64
          // console.log(base64)
          const { url, name } = await uploadImage(buffer)
          console.log(url)
          // 更新图片
          window.app.data[inp.id].inputs.image = name
        }
      })
    }
  }

  // 文本输入
  for (let index = 0; index < app.input.length; index++) {
    const inp = app.input[index]
    // 节点可能不存在
    if (inp?.inputs?.text) {
      const [div, textInput] = createTextInput(inp.title, inp.inputs.text)
      mainDom.appendChild(div)
      textInput.addEventListener('change', e => {
        e.preventDefault()
        // 更新文本
        window.app.data[inp.id].inputs.text = textInput.value
      })
    }
  }

  // 数字输入number
  for (let index = 0; index < app.input.length; index++) {
    const inp = app.input[index]
    // 节点可能不存在
    if (inp?.inputs?.number) {
      const [div, numInput] = createNumberSelectInput(
        inp.title,
        inp.inputs.number,
        inp.options
      )
      mainDom.appendChild(div)
      numInput.addEventListener('change', e => {
        e.preventDefault()
        // 更新数字
        window.app.data[inp.id].inputs.number = numInput.value
      })
    }
  }

  // 选项框 - 模型
  for (let index = 0; index < app.input.length; index++) {
    let data = app.input[index]
    // 节点可能不存在
    if (
      data &&
      ['CheckpointLoaderSimple', 'LoraLoader'].includes(data.class_type)
    ) {
      let value = data.inputs.ckpt_name || data.inputs.lora_name

      // 缓存数据
      try {
        let v = localStorage.getItem(`_model_${data.id}_${data.class_type}`)
        if (v) {
          value = v
          if (data.class_type === 'CheckpointLoaderSimple') {
            // 更新
            window.app.data[data.id].inputs.ckpt_name = value
          }
          if (data.class_type === 'LoraLoader') {
            // 更新
            window.app.data[data.id].inputs.lora_name = value
          }
        }
      } catch (error) {}

      let [div, selectDom] = createSelectWithOptions(
        data.title,
        Array.from(data.options, o => {
          return {
            value: o,
            text: o
          }
        }),
        value
      )
      mainDom.appendChild(div)

      // 选择事件绑定
      selectDom.addEventListener('change', e => {
        e.preventDefault()
        // console.log(selectDom.value)
        if (data.class_type === 'CheckpointLoaderSimple') {
          window.app.data[data.id].inputs.ckpt_name = selectDom.value
        }
        if (data.class_type === 'LoraLoader') {
          window.app.data[data.id].inputs.lora_name = selectDom.value
        }

        localStorage.setItem(
          `_model_${data.id}_${data.class_type}`,
          selectDom.value
        )
      })
    }
  }

  // 运行按钮
  const runBtn = document.createElement('button')
  runBtn.innerText = 'RUN ' + `${api.clientId ? '+' : '-'}`
  mainDom.appendChild(runBtn)

  runBtn.addEventListener('click', e => {
    e.preventDefault()
    const seed = app.seed
    let prompt = app.data

    // seed 为 fixed 处理成random
    for (const key in seed) {
      if (seed[key] == 'fixed') seed[key] = 'randomize'
    }

    // 随机seed
    prompt = randomSeed(seed, prompt)

    const data = JSON.stringify({ prompt, client_id: api.clientId })
    runMyApp(hostUrl, data)
  })

  // focus
  document.body.addEventListener('focus', e => {
    console.log('#focus')
  })
}

async function showAppsNames () {
  // const { width, height } = photoshop.activeDocument

  const api = new ComfyApi()
  const statusDoms = document.querySelectorAll('.status')
  api.addEventListener('status', ({ detail }) => {
    console.log('status', detail, detail?.exec_info?.queue_remaining)

    try {
      if (detail === null) {
        // 失败
        Array.from(
          statusDoms,
          s => (s.innerText = 'Please check the server address.')
        )
      } else {
        Array.from(
          statusDoms,
          s =>
            (s.innerText = `queue_remaining:${detail?.exec_info?.queue_remaining}`)
        )
      }
    } catch (error) {
      console.log(error)
    }
  })

  api.addEventListener('progress', ({ detail }) => {
    console.log('progress', detail)
    const class_type = window.app.data[detail?.node]?.class_type || ''
    try {
      let p = `${parseFloat((100 * detail.value) / detail.max).toFixed(
        1
      )}% ${class_type}`
      Array.from(statusDoms, s => (s.innerText = `progress:${p}`))

      console.log('progress', p)
    } catch (error) {}
  })

  api.addEventListener('executed', async ({ detail }) => {
    console.log('executed', detail)
    // if (!enabled) return;
    const images = detail?.output?.images
    const _images = detail?.output?._images
    const prompts = detail?.output?.prompts

    const nodeId = detail.node

    // 匹配输出，才show
    if (!window.app.output.filter(o => o.id === nodeId)[0]) return

    if (images) {
      // if (!images) return;

      let url = hostUrl

      show(
        Array.from(images, img => {
          return `${url}/view?filename=${encodeURIComponent(
            img.filename
          )}&type=${img.type}&subfolder=${encodeURIComponent(
            img.subfolder
          )}&t=${+new Date()}`
        }),
        detail.node,
        'images'
      )
    } else if (_images && prompts) {
      let url = hostUrl

      let items = []
      // 支持图片的batch
      Array.from(_images, (imgs, i) => {
        for (const img of imgs) {
          items.push([
            `${url}/view?filename=${encodeURIComponent(img.filename)}&type=${
              img.type
            }&subfolder=${encodeURIComponent(img.subfolder)}&t=${+new Date()}`,
            prompts[i]
          ])
        }
      })

      show(items, detail.node, 'images_prompts')
    }
  })

  api.addEventListener('execution_error', ({ detail }) => {
    console.log('execution_error', detail)
    Array.from(
      statusDoms,
      s => (s.innerText = `execution_error:${JSON.stringify(detail)}`)
    )
  })

  api.addEventListener('execution_start', async ({ detail }) => {
    console.log('execution_start', detail)
    try {
      Array.from(
        statusDoms,
        s => (s.innerText = `execution_start:${detail?.prompt_id}`)
      )
    } catch (error) {}
  })

  let url = new URL(hostUrl)
  console.log('#init', hostUrl)
  api.api_host = url.host
  api.api_base = ''
  api.protocol = url.protocol
  api.init()

  window.api = api

  const apps = await getMyApps(hostUrl, 'photoshop', null, true)
  const sortedNames = Array.from(apps, a => {
    return {
      text: a.filename.split('.json')[0],
      value: a.filename
    }
  })

  const appDom = document.getElementById('apps')
  appDom.innerText = ''
  const mainDom = document.getElementById('main')
  mainDom.innerText = ''

  // 选择app
  const [appsSelectDom, selectElement] = createSelectWithOptions(
    'Select',
    sortedNames,
    sortedNames[0].value
  )
  // 选择事件绑定
  selectElement.addEventListener('change', e => {
    e.preventDefault()
    createApp(apps, selectElement.value, mainDom)
  })

  appDom.appendChild(appsSelectDom)

  createApp(apps, apps[0].filename, mainDom)

  Array.from(statusDoms, s => (s.innerText += ` apps:${apps.length}`))

  // // 尺寸调整
  // const widthInput = document.createElement('input')
  // widthInput.type = 'number'
  // widthInput.value = width

  // const heightInput = document.createElement('input')
  // heightInput.type = 'number'
  // heightInput.value = height

  // appDom.appendChild(widthInput)
  // appDom.appendChild(heightInput)
}
