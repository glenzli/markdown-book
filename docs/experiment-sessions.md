# 实验会话 / Experiment sessions

`mount({element, props, signal, session})` 的 session 是可选能力，不改变格式版本1。
旧版阅读器不提供它；组件应以 `session?.load()` 等形式调用。

- `load()`：返回当前实例的 JSON 副本，首次为 undefined。
- `save(value)`：保存有限 JSON 的副本，每个值最多8192字节（按UTF-16计数）；不接受函数、循环、非有限数或危险原型键。
- `describe(capture)`：注册讨论快照函数。返回 JSON（最多16384字节），写明标题、参数、单位、读数及模型条件；不返回函数或 DOM。

身份由书籍、本章ID、组件ID和本章内同名组件的出现序号确定。原生模式额外绑定规范化书籍根路径。
单书最多128条、约128 KiB状态；超限淘汰较早的条目。重复同名组件重新排序会改变实例身份。
每个组件应自行保存 schema 版本，校验恢复值的范围；版本不兼容时使用默认值。

```js
export function mount({ element, signal, session }) {
  const saved = session?.load();
  let value =
    saved?.version === 1 && Number.isFinite(saved.value)
      ? Math.max(0, Math.min(100, saved.value))
      : 50;
  const input = document.createElement("input");
  input.type = "range";
  input.min = 0;
  input.max = 100;
  input.value = value;
  const snapshot = () => ({ title: "示例", parameters: { percent: value } });
  session?.describe(snapshot);
  input.addEventListener(
    "input",
    () => {
      value = Number(input.value);
      session?.save({ version: 1, value });
    },
    { signal },
  );
  element.append(input);
  return () => element.replaceChildren();
}
```

网站模式使用当前来源下的浏览器本地存储，以 base 和 bookId 隔离。原生模式通过 App 专用
`save_reader_experiments` 保存到最近阅读状态文件旁的 `<statefile>.experiments`；默认是
`~/.markdown-book/recent-books.json.experiments`。它采用同一短时跨进程锁与原子替换规则，
保留在本机，不依赖面板提供 localStorage 或 widgetState，也不写入 book.json/Markdown。
旧版读者改写最近列表不会覆盖实验状态。保存失败会在面板显示错误。

切章、换书、关闭面板时刷新待保存状态；换书等待保存完成，再绑定新书籍。
长动画可以随绘制更新保存值，读者会合并180毫秒内的变更；恢复后必须暂停，不能自动启动计时器。
组件应只保存重建所需的参数、随机种子、步骤等，不保存帧图、FFT数组、模型对象或观察器。

参与 describe 的组件显示“讨论这个实验”。顶部讨论入口附上视口中的已挂载实验；专用按钮只取该实验。
打开讨论时冻结一次快照，预览参数与读数，可取消勾选。随后拖动滑块不改变已打开的引用；重新打开讨论
会取新快照。引用为书籍提供的数据，不是执行指令。Codex 创建可编辑的新讨论草稿，保持 send:false；
网页模式复制相同材料，用户自行发送。未提供 describe 的旧组件继续支持正文引用。

The optional session persists bounded finite JSON per book/chapter/component occurrence. Models own schema validation,
units and reconstruction; restore playback paused. Native state is stored locally beside the recent-books file with
locking and atomic replacement. Web state uses localStorage. Descriptions become frozen, user-reviewed discussion
attachments; they never execute code or automatically send a message. Old components and readers remain compatible.
