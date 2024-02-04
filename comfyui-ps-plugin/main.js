const { entrypoints } = require('uxp')

showAlert = () => {
  alert('This is an alert message')
}

entrypoints.setup({
  commands: {
    showAlert
  },
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

async function showAppsNames () {

  const photoshop = require('photoshop').app;
  const activeDocument=photoshop.activeDocument;
  const {width,height}=activeDocument;

  const apps = await getMyApps('http://127.0.0.1:8188', 'photoshop', null, true)
  const sortedNames = Array.from(apps, a => {
    return {
      text: a.filename.split('.json')[0],
      value: a.filename
    }
  })

  let app = {} //待运行的app

  const appDom = document.getElementById('apps')
  appDom.innerText = ''

  // 选择app
  const [appsSelectDom, selectElement] = createSelectWithOptions(
    'Select',
    sortedNames,
    sortedNames[0].value
  )
  // 选择事件绑定
  selectElement.addEventListener('change', e => {
    e.preventDefault()
    app=apps.filter(app => app.filename === selectElement.value)[0]
    console.log(app)

    // 输入和输出的ui创建
    app

  })

  appDom.appendChild(appsSelectDom)

  // 尺寸调整
  const widthInput = document.createElement("input");
  widthInput.type='number';
  widthInput.value=width;

  const heightInput = document.createElement("input");
  heightInput.type='number';
  heightInput.value=height;


  appDom.appendChild(widthInput)
  appDom.appendChild(heightInput)


}

document.getElementById('btnPopulate').addEventListener('click', showAppsNames)
