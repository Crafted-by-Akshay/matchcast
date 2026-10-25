// The languages a viewer can pick (ADR-0023), one list for the shell, Watch and the Broadcast desk.
// The api translates a verified line into each of these; a line with no checked translation stays English and says so.
window.MC_LANGS = ['en', 'es', 'pt', 'hi', 'ar', 'fr', 'de', 'id', 'ja', 'zh-Hans'];
// the speech-recognition locale for each language (the mic in Watch and the desk)
window.MC_SPEECH_LOCALE = { en: 'en-US', es: 'es-ES', pt: 'pt-BR', hi: 'hi-IN', ar: 'ar-SA', fr: 'fr-FR', de: 'de-DE', id: 'id-ID', ja: 'ja-JP', 'zh-Hans': 'zh-CN' };
window.MC_LANG_NAMES = { en: 'English', es: 'Español', pt: 'Português', hi: 'हिन्दी', ar: 'العربية', fr: 'Français', de: 'Deutsch', id: 'Bahasa Indonesia', ja: '日本語', 'zh-Hans': '简体中文' };
