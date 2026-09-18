# Email to event - Thunderbird plugin
This Thunderbird plugin enables easy creation of a calendar event based on an email content. Upon user request, dates in the email's subject and body are detected to make event creation easy

This plugin was inspired by how smartphones enable easy event creation of their email client.

## Create addon zip XPI file
```bash
npm ci --omit=dev
npm run build
```

## Development

```shell
npm install
npm run bundle-dependencies
npm run dev
npm run lint
```

