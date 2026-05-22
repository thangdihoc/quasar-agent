// plugins/hello/handler.js
// Example plugin handler

const greetings = {
  en: 'Hello',
  vi: 'Xin chào',
  ja: 'こんにちは',
  ko: '안녕하세요',
}

export default async function greet(args) {
  const lang = args.language || 'en'
  const name = args.name || 'World'
  const greeting = greetings[lang] || greetings.en
  return `${greeting}, ${name}! 👋 (from hello plugin)`
}
