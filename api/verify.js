export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  const message = req.body.message;

  if (!message || !message.text) {
    return res.status(200).send('no message');
  }

  if (message.text === '/appss_verify') {
    await fetch('https://api.telegram.org/bot8970862413:AAFfsYn0ZNxdj72DMz8moDuF6E0xT_3Y7tw/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: 'appss_bf12e9'
      })
    });
  }

  return res.status(200).send('ok');
}
