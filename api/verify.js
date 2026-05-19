```javascript id="4n5b1y"
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  const body = req.body;

  const message = body.message;

  if (!message || !message.text) {
    return res.status(200).send('no message');
  }

  const chatId = message.chat.id;
  const text = message.text;

  if (text === '/appss_verify') {
    await fetch('https://api.telegram.org/bot8970862413:AAFfsYn0ZNxdj72DMz8moDuF6E0xT_3Y7tw/sendMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: 'appss_bf12e9',
      }),
    });
  }

  return res.status(200).send('ok');
}
```
