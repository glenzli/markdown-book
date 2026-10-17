# 三维组件

Three.js 适合解释具有空间结构或运动过程的机制，例如光锥与像面、曲面传感器、场曲和扫描时序。信噪比、编码曲线和参数比较通常用二维图表更清楚。场景应围绕一个可计算的关系展开，说明模型条件、单位、尺度和示意边界。

## 共用引擎

```js
import {
  BoxGeometry,
  Mesh,
  MeshNormalMaterial,
  createThreeViewport,
} from "@glenzli/markdown-book/three";

export function mount({ element, signal }) {
  const stage = document.createElement("div");
  stage.style.height = "320px";
  element.append(stage);
  const viewport = createThreeViewport({ element: stage, signal });
  const cube = new Mesh(new BoxGeometry(20, 20, 20), new MeshNormalMaterial());
  viewport.scene.add(cube);
  viewport.render();
  return () => {
    viewport.dispose();
    stage.remove();
  };
}
```

这个入口导出 Three.js 公共 API、OrbitControls 和视口助手。工具固定引擎版本，在 `check / serve / build` 时解析此模块；书籍目录不需要 node_modules。其他 Three.js addons 暂不作为公共导出。组件仍通过清单和 `data-mb-component` 声明，并保留有相邻说明的静态图片。

## 视口生命周期

`createThreeViewport` 接收 `element`、组件 `signal`、可选 `onFrame({ delta, elapsed })`、`onRender` 和 `onPlaybackChange`；时间单位为秒。返回 scene、camera、controls、renderer，以及 render、resize、setPlaying、dispose 方法和 playing、reducedMotion 状态。

- 默认暂停，事件改变场景后调用 render。OrbitControls 的拖动触发重绘，不要求常驻动画循环。
- setPlaying(true) 开始动画；离开视口或隐藏页面时停帧，重新可见后恢复。减少动态效果偏好切换为启用时停止播放；组件应提供可访问的播放按钮。
- ResizeObserver 更新画布和相机比例；像素比上限为 2，限制高分屏的 GPU 开销。
- signal 中止或 dispose 会关闭循环与观察器、移除事件、释放场景中几何体、材质、纹理和 renderer，并关闭 WebGL context。dispose 可重复调用。
- 组件动态移除的对象及额外渲染目标由组件自己释放。挂载失败时 Reader 保留静态回退；切回静态图也会暂停三维视口，返回互动后才恢复。

组件可以使用 Shadow DOM 隔离样式。Three.js 的 WebGLRenderer 需要 WebGL 2；初始化不可用时应抛出挂载错误，让 Reader 显示原静态图。

## 两种输出

普通网页保持代码分块，三维组件接近视口时才加载。原生 MCP App 从同一组构建模块中，仅合并当前页实际声明的组件；章节首页和纯文字页不包含 Three.js。原生 App 内的字体、图片和程序通过 MCP 传入，不访问 CDN。

学科模型留在书籍仓库，工具只负责引擎和视口生命周期。第十六章示例的纯函数模型、数值边界测试和场景都在 Curio 的 `interactives/focus/`。
