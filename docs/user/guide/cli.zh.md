# 终端 CLI

[English](cli.md) | 中文

`dsh cli` 在终端中运行 DeepSeek Harness 智能体。它启动与 Web 界面相同的
主机组合（智能体核心、工具、沙箱、持久化），并在进程内传输之上挂载终端
客户端平面：无浏览器、无 Web 监听、无 React。这里同样一切皆插件：终端
功能包通过内核的节点渲染、命令与行预处理注册表组合进对话流，roster 与
其他 profile 一样可被补丁修改。

## 运行

```sh
dsh cli                        # 交互会话
dsh cli "run the tests"        # 回答一个任务，打印运行并退出
dsh cli --session <id>         # 续接会话
dsh cli --cwd <dir> --model provider/model --permission workspace-write
```

## 命令

`/help`、`/sessions [id前缀]`、`/new`、`/model [n]`、`/like [备注]`、
`/dislike [备注]`、`/memory`、`/quit`，以及主机命令 `/plan`、
`/goal`、`/compact`、`/permission <preset>`、`/feedback`、
`/export`。

审批与 ask_user_question 提示以内联形式渲染并让输入行进入应答模式。
`@path/to/image.png` 可附加图片。

## 内存

追求最低占用时，限制堆大小运行：

```sh
NODE_OPTIONS="--max-old-space-size=256 --optimize-for-size" dsh cli
```

实测（macOS arm64，Node 24）：空闲 RSS 约 158 MB（使用上述旗标，默认
V8 约 223 MB），运行中约 163 MB，启动到首个流式输出约 1.6 秒（含一次
模型往返）。cli profile 禁用了 OTel 遥测行；终端界面不上传遥测。
