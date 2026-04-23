# Browser Use Desktop

<img width="1456" height="484" alt="desktop-app-banner" src="https://github.com/user-attachments/assets/550ca16a-5a61-4ded-92f0-a30421870223" />

## A desktop app for running browser agents. 

Running automations on your local Chrome interferes with your daily work and also requires permissions every time. 

Browser Use Desktop allows you to port your cookies into a new Chromium environment and run tasks there, with a new interface. 

## Channels

Inbound message channels can trigger agent sessions automatically. Currently, we have set up WhatsApp (texting yourself -> communicating with agent) 

- **WhatsApp** — receives messages via WhatsApp Web bridge, routes them through ChannelRouter to create agent sessions

## Development

Requires [Task](https://taskfile.dev) (`brew install go-task`).

```bash
task up    # Install deps and start the app
```

## License

MIT

MIT
