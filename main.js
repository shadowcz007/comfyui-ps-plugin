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
    setInterval(async () => {
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
      if (this.socket) this.socket.close()
      if (!isReconnect && !opened) {
        this.#pollQueue()
      }
    })

    this.socket.addEventListener('close', () => {
      setTimeout(() => {
        this.socket = null
        this.#createSocket(true)
      }, 300)
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
// 当前的workflow
window.app = null

const hostUrl = 'http://127.0.0.1:8188'


entrypoints.setup({
  panels: {
    vanilla: {
      show (node) {}
    }
  }
})

function showLayerNames () {
  const app = require('photoshop').app
  const allLayers = app.activeDocument.layers
  const allLayerNames = allLayers.map(layer => layer.name)
  const sortedNames = allLayerNames.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  document.getElementById('apps').innerHTML = `
      <ul>${sortedNames.map(name => `<li>${name}</li>`).join('')}</ul>`
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

// 创建文本输入 - 带说明
function createTextInput (title, defaultValue) {
  // Create a container for the upload control
  const uploadContainer = document.createElement('div')
  uploadContainer.className = 'card'

  // Create a label for the upload control
  const nameLabel = document.createElement('label')
  nameLabel.textContent = title
  uploadContainer.appendChild(nameLabel)

  // Create an input field for the image name
  const textInput = document.createElement('textarea')
  textInput.value = defaultValue

  uploadContainer.appendChild(textInput)

  return [uploadContainer, textInput]
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

  const value=document.createElement('label');
  value.innerText=defaultValue;

  numInput.addEventListener('change',e=>{
    value.innerText=numInput.value;
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
    if (currentDocument) {
      await newDocument.activeLayers[0].duplicate(currentDocument)
      await newDocument.close()
    }

    // 删除
    await image.delete()
  } catch (e) {
    console.log(e)
  }
}

async function show (src, id, type = 'image') {
  console.log('#show', id, src)

  if (src && type == 'image') {
    await downloadIt(src)
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

      await downloadIt(url)
    }
  }
}

function createApp (apps, targetFilename, mainDom) {
  window.app = apps.filter(ap => ap.filename === targetFilename)[0]
  // console.log(app,api.clientId)
  const app = window.app

  mainDom.innerHTML = ''

  // 输入和输出的ui创建
  // 文本输入
  for (let index = 0; index < app.input.length; index++) {
    const inp = app.input[index]
    if (inp.inputs?.text) {
      const [div, textInput] = createTextInput(inp.title, inp.inputs.text)
      mainDom.appendChild(div)
      textInput.addEventListener('change', e => {
        e.preventDefault()
        // 更新文本
        app.data[inp.id].inputs.text = textInput.value
      })
    }
  }

  // 数字输入number
  for (let index = 0; index < app.input.length; index++) {
    const inp = app.input[index]
    if (inp.inputs?.number) {
      const [div, numInput] = createNumberSelectInput(
        inp.title,
        inp.inputs.number,
        inp.options
      )
      mainDom.appendChild(div)
      numInput.addEventListener('change', e => {
        e.preventDefault()
        // 更新数字
        
        app.data[inp.id].inputs.number = numInput.value
        
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
}

async function showAppsNames () {
  // const { width, height } = photoshop.activeDocument

  const api = new ComfyApi()

  api.addEventListener('status', ({ detail }) => {
    console.log('status', detail, detail.exec_info?.queue_remaining)
    try {
    } catch (error) {
      console.log(error)
    }
  })

  api.addEventListener('progress', ({ detail }) => {
    console.log('progress', detail)
    const class_type = app.data[detail?.node]?.class_type || ''
    try {
      let p = `${parseFloat((100 * detail.value) / detail.max).toFixed(
        1
      )}% ${class_type}`
      console.log('progress', p)
    } catch (error) {}
  })

  api.addEventListener('executed', async ({ detail }) => {
    console.log('executed', detail)
    // if (!enabled) return;
    const images = detail?.output?.images

    const _images = detail?.output?._images
    const prompts = detail?.output?.prompts

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
    // show(URL.createObjectURL(detail));
  })

  api.addEventListener('execution_start', async ({ detail }) => {
    console.log('execution_start', detail)
    try {
    } catch (error) {}
  })

  api.api_host = hostUrl.replace('http://', '')
  api.api_base = ''
  api.protocol = 'http'
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

document.getElementById('btnPopulate').addEventListener('click', showAppsNames)