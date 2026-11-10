# YouTube Transkript + Özet (Chrome eklentisi)

YouTube videosunun transkriptini çeker ve tek tıkla **ChatGPT** veya **Claude** sekmesinde özetletir.

- **Ücretsiz:** Ücretli API yok, abonelik yok.
- **API anahtarı gerekmez:** Özet, sizin kendi ChatGPT/Claude oturumunuzda yapılır.
- **Gizlilik:** Eklentinin sunucusu yoktur; transkript yalnızca sizin açtığınız ChatGPT/Claude sekmesine gider.

## Özellikler

- Video sayfasının sağ sütununa **"📝 Transkript + Özet"** paneli ekler.
- Transkripti zaman damgalı gösterir; zamana tıklayınca video o ana gider.
- Altyazı dili seçimi (elle yazılmış altyazı, otomatik olana tercih edilir).
- Özelleştirilebilir prompt şablonu (`{title}`, `{url}`, `{transcript}` yer tutucuları).
- Transkripti panoya kopyalama veya `.txt` olarak indirme.

## Kurulum

Eklenti henüz Chrome Web Mağazası'nda değil; geliştirici modunda yüklenir:

1. Depoyu indirin: `git clone https://github.com/harunercoban2/youtube-transkript-ozet.git`
   (veya **Code → Download ZIP** ile indirip açın).
2. Chrome'da `chrome://extensions` adresini açın.
3. Sağ üstten **Geliştirici modu**'nu açın.
4. **Paketlenmemiş öğe yükle** → indirdiğiniz `youtube-transkript-ozet` klasörünü seçin.
5. Herhangi bir YouTube videosunu açın; sağ sütunun üstünde panel belirir.

Chromium tabanlı diğer tarayıcılarda (Edge, Brave, Opera) da aynı yolla çalışır.

## Kullanım

| Buton | Ne yapar |
|---|---|
| **Transkripti Al** | Transkripti çeker ve panelde zaman damgalı gösterir. |
| **ChatGPT'de Özetle / Claude'da Özetle** | Prompt'u panoya kopyalar ve ilgili siteyi yeni sekmede açar. Kısa transkriptlerde prompt adres çubuğu üzerinden otomatik dolar; uzunlarda açılan sekmede **Ctrl/Cmd+V** yapın. |
| **Promptu Kopyala** | Yalnızca panoya kopyalar (istediğiniz yapay zekâya yapıştırın). |
| **Transkripti Kopyala / .txt İndir** | Ham transkripti alır. |

Eklenti simgesine tıklayarak **prompt şablonunu**, tercih edilen altyazı dilini ve zaman damgası
seçeneğini değiştirebilirsiniz.

## Nasıl çalışır

1. Önce YouTube'un kendi altyazı kaynağı (`captionTracks` → timedtext) denenir.
2. Bu kaynak boş dönerse sayfadaki **"Transkripti göster"** paneli açılır ve metin sayfadan okunur.
3. "Özetle" butonu prompt'u oluşturur, panoya kopyalar ve ChatGPT/Claude'u yeni sekmede açar.

## İzinler

| İzin | Neden |
|---|---|
| `storage` | Prompt şablonu ve dil tercihini saklamak için. |
| `clipboardWrite` | Prompt'u ve transkripti panoya kopyalamak için. |
| İçerik betiği: `youtube.com` | Paneli yalnızca YouTube sayfalarına eklemek için. |

Eklenti başka hiçbir siteye erişmez, arka plan betiği yoktur ve veri toplamaz.

## Sınırlamalar

- YouTube 2025'ten beri timedtext isteklerinde ek doğrulama istiyor; bu kaynak çoğu videoda boş
  döner ve eklenti sayfadaki transkript paneline geçer. Bu durumda transkript, YouTube'un o anda
  panelde gösterdiği dilde gelir (panelden seçilen dil yok sayılabilir).
- Altyazısı olmayan videolarda transkript alınamaz.
- YouTube arayüzünü değiştirdikçe eklentinin güncellenmesi gerekebilir.
- Masaüstü `www.youtube.com` izleme sayfasında test edilmiştir; mobil site (`m.youtube.com`) desteklenmez.
- Prompt'un adres çubuğuyla otomatik dolması ChatGPT/Claude'un `?q=` desteğine bağlıdır; bu
  çalışmazsa prompt zaten panodadır.
- Özet için ChatGPT veya Claude hesabınızda oturum açmış olmanız gerekir.

## Dosyalar

```
manifest.json   Manifest V3 tanımı
content.js      YouTube sayfasına eklenen panel ve transkript mantığı
content.css     Panel stili (açık/koyu tema uyumlu)
popup.html/js   Ayarlar penceresi
icons/          Simgeler
```

## Lisans

MIT. Ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.

---

Geliştirici: [Harun Erçoban](https://harunercoban.com)
