# @deepseek-ai/dsh-cli-app

dsh 终端界面 bundle：覆盖在 `dsh-base` 之上的 cli 补丁层，加上进程内
客户端平面运行器。

`dsh cli` 启动与各界面共享的主机组合（agent 核心、工具、沙箱、持久化），
把网关组合为单个 fetch 形态处理器，在其上启动 Node 驻留的终端客户端
上下文，并打开或续接会话。`dsh cli "<task>"` 打印一次运行后退出；不带
参数则为交互模式。

## Model Experience

人格与默认模型沿用共享的 `dsh-base` 配置；本 bundle 仅重申共享系统
提示词，不新增模型可见内容。
