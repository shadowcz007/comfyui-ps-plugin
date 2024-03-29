# comfyui-mixlab-ps-plugin

Turn your workflow into a Photoshop plugin.

把你的工作流变成Photoshop插件。


Create a workflow for Photoshop using the appinfo of [comfyui-mixlab-nodes](https://github.com/shadowcz007/comfyui-mixlab-nodes). Name the category of appinfo as "photoshop" so that it can be accessed.

使用[comfyui-mixlab-nodes的appinfo](https://github.com/shadowcz007/comfyui-mixlab-nodes)创建适用于Photoshop的workflow。 appinfo的category用photoshop命名即可读取


## text-to-image 

- step 1 : install [comfyui-mixlab-nodes](https://github.com/shadowcz007/comfyui-mixlab-nodes)

- step 2 : create your workflow

- step 3 : and add appinfo node.

![](./examples/text-to-image.png)

- step 4 : install [mixlab photoshop plugin](https://github.com/shadowcz007/comfyui-ps-plugin/blob/main/dist/comfyui-mixlab-ps-plugin_PS.ccx)

![](./examples/text-to-image-ps.jpg)


## image-to-image

- Now you can use the LoadImage node as input to implement the image-to-image workflow.

- supports MASK.

![img-to-img](./examples/img-to-img.png)

![mask](./examples/img-to-img-mask.png)


## download
[comfyui-mixlab-ps-plugin_PS.ccx](./dist/comfyui-mixlab-ps-plugin_PS.ccx)


### 开发插件

安装 [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/)  

[uxp-photoshop-plugin-samples](https://github.com/AdobeDocs/uxp-photoshop-plugin-samples/blob/main/cross-compatible-js-sample/src/index.js)

[developer.adobe.com](https://developer.adobe.com/photoshop/uxp/2022/)

* 一些开发过程问题的记录：
> 本插件目前支持 22.5.0，更高的版本未测试。
> 暂未支持：Imaging API Beta , Photoshop 24.2 (February 2023)
> clipboard只能读取文本
> uxp的打包工具会把隐藏目录也打进去，增加了包体大小……

##### 答疑交流

> [discord](https://discord.gg/cXs9vZSqeK)

> 关注微信公众号：mixlab 无界社区

