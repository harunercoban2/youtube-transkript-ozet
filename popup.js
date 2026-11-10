const DEFAULTS = {
  promptTemplate:
    'Aşağıdaki YouTube videosunun transkriptini Türkçe olarak özetle.\n' +
    '- Önce 2-3 cümlelik genel özet ver.\n' +
    '- Sonra ana noktaları madde madde sırala.\n' +
    '- Varsa önemli sonuç, öneri veya çıkarımları ayrıca belirt.\n\n' +
    'Başlık: {title}\nURL: {url}\n\nTranskript:\n{transcript}',
  includeTimestamps: false,
  preferredLang: 'tr'
};

const $ = (id) => document.getElementById(id);

function fill(v) {
  $('promptTemplate').value = v.promptTemplate;
  $('preferredLang').value = v.preferredLang;
  $('includeTimestamps').checked = !!v.includeTimestamps;
}

chrome.storage.sync.get(DEFAULTS, fill);

$('save').addEventListener('click', () => {
  const v = {
    promptTemplate: $('promptTemplate').value.trim() || DEFAULTS.promptTemplate,
    preferredLang: $('preferredLang').value,
    includeTimestamps: $('includeTimestamps').checked
  };
  chrome.storage.sync.set(v, () => {
    $('saved').textContent = 'Kaydedildi ✓';
    setTimeout(() => ($('saved').textContent = ''), 1500);
  });
});

$('reset').addEventListener('click', () => {
  chrome.storage.sync.set(DEFAULTS, () => { fill(DEFAULTS); $('saved').textContent = 'Sıfırlandı'; setTimeout(() => ($('saved').textContent = ''), 1500); });
});
