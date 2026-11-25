# MCP Financial Tracker (`mcp-ifintrack`)

Server MCP TypeScript untuk Financial Tracker (`akunkeuangan-service-v2`), Users/Permissions, Audit Trail, dan Daily Schedule, lengkap dengan dokumentasi kontrak referensi.

## Prompt Instalasi Cepat (Salin ke Chatbot / Coding Agent)

Cukup salin prompt berikut ke chatbot Anda untuk menginstal dan menghubungkan MCP server ini secara otomatis. Chatbot akan menanyakan terlebih dahulu apakah Anda ingin masuk dengan **Email/Username + Password** atau **Bearer Token langsung**:

```text
Tolong instal dan hubungkan MCP server Financial Tracker dari repository GitHub berikut:
https://github.com/rafaelvitoadrian/mcp-ifintrack.git

Ikuti langkah-langkah berikut secara berurutan:
1. SEBELUM mengonfigurasi MCP server, TANYAKAN terlebih dahulu kepada saya:
   - Metode autentikasi yang ingin dipakai:
     (a) Email / Username + Password, ATAU
     (b) Bearer Token langsung
   - Minta saya memasukkan kredensial sesuai pilihan tersebut (serta opsional URL backend jika berbeda dari https://dev-ifintrack.rafaelvito.online).
   - Tunggu jawaban saya sebelum melanjutkan konfigurasi env/MCP client.
2. Clone repository ke folder lokal (`./mcp-ifintrack`):
   git clone https://github.com/rafaelvitoadrian/mcp-ifintrack.git mcp-ifintrack
3. Masuk ke folder `server`, instal dependency, dan build TypeScript:
   cd mcp-ifintrack/server
   npm install
   npm run build
4. Simpan kredensial yang saya berikan HANYA di konfigurasi env host MCP client (atau di file lokal `mcp-ifintrack/server/.env` yang ter-gitignore, JANGAN pernah di-commit ke git):
   - Jika saya memilih Email/Username + Password: isi `FINTRACK_EMAIL` dan `FINTRACK_PASSWORD` (kosongkan `FINTRACK_TOKEN`).
   - Jika saya memilih Token langsung: isi `FINTRACK_TOKEN` (kosongkan `FINTRACK_EMAIL` dan `FINTRACK_PASSWORD`).
5. Daftarkan MCP server ini pada konfigurasi MCP client dengan transport `stdio`:
   - command: "node"
   - args: ["<PATH_ABSOLUT_KE>/mcp-ifintrack/server/dist/index.js"]
   - env:
       FINTRACK_API_BASE_URL: "https://dev-ifintrack.rafaelvito.online"
       FINTRACK_TIMEZONE: "Asia/Jakarta"
       (beserta FINTRACK_EMAIL + FINTRACK_PASSWORD, ATAU FINTRACK_TOKEN)
6. Setelah terhubung, panggil `get_authorized_permission_profiles` untuk memverifikasi akun yang sedang aktif dan daftar izinnya (tanpa menampilkan token atau password).
```

### Prompt Ganti Akun (Switch Account)

```text
Saya ingin ganti akun pada MCP Financial Tracker.
Tanyakan kepada saya apakah saya ingin masuk dengan (1) Email/Username + Password atau (2) Bearer Token baru, lalu perbarui konfigurasi env MCP Financial Tracker (atau file lokal `server/.env`) dengan kredensial baru tersebut, restart koneksi MCP server, dan panggil `get_authorized_permission_profiles` untuk memastikan akun baru sudah aktif.
```

Atau jalankan di terminal:
```bash
cd server && npm run switch-account
```

Panduan lengkap konfigurasi client, mode Streamable HTTP, dan System Prompt chatbot tersedia di [CHATBOT_INSTALL.md](CHATBOT_INSTALL.md) dan [server/README.md](server/README.md).

---

## Referensi Kontrak & Dokumentasi

Snapshot: 6 November 2026. Endpoint diambil dari client aplikasi, bukan hasil pemeriksaan backend langsung pada tanggal tersebut. Cocokkan lagi dengan backend tujuan sebelum implementasi.

## Isi

| File | Kegunaan |
| --- | --- |
| [CHATBOT_INSTALL.md](CHATBOT_INSTALL.md) | Panduan instalasi chatbot, prompt ganti akun, dan system prompt |
| [server/README.md](server/README.md) | Dokumentasi teknis server MCP, mapping 39 tools, dan hasil tes |
| [ENDPOINTS.md](ENDPOINTS.md) | Daftar method, path, query, encoding dan efek samping |
| [CONTRACTS.md](CONTRACTS.md) | Autentikasi, payload, revisi dan aturan transport |
| [TOOLS.md](TOOLS.md) | Usulan mapping tool MCP ke API |
| [PROMPT.md](PROMPT.md) | Prompt implementasi yang bisa disalin ke coding agent |
| [examples/requests.json](examples/requests.json) | Contoh request HTTP/MCP sebagai data referensi |
| [.env.example](.env.example) | Usulan environment untuk server baru |

Mulai dari ENDPOINTS dan CONTRACTS, lalu gunakan PROMPT saat membangun server baru. Nilai `<...>` dan ID contoh harus diganti dengan data sesi/hasil API yang sah. Jangan mengeksekusi contoh mutasi tanpa memeriksa target dan persetujuan pengguna.

## Implementasi yang sudah tersedia pada repo asal

- `mcp.js`: handler MCP dan pemeriksaan preview/tindakan.
- `mcp-catalog.js`: schema tools baca dan tulis.
- `docs/MCP.md`: protokol serta approval host.
- `src/services/config.js`: path endpoint.
- `src/services/api.js`: method HTTP, query, header dan encoding.
- `src/utils/payload.js`: payload akun/user dan lifecycle.
- `src/utils/users.js`: role/profile forms dan verifikasi assignment.
- `src/utils/transactions.js`: payload transaksi.
- `src/utils/audit.js`: filter audit dan redaksi data.
- `src/utils/dto.js`: normalisasi respons keuangan.
- `agent-service/src/tools.ts`, `financial-tracker.ts`, `money.ts`: tools analisis baca dan perhitungan desimal Mastra.

Nama file tersebut merupakan penunjuk ke repo asal; folder referensi ini tidak bergantung pada file itu untuk dibaca. Untuk memakai ulang implementasinya, ambil sumber dari repo asal beserta dependency dan tests terkait.

Folder ini tidak memuat token, password, API key, database atau respons data pengguna. `.env.example` merupakan usulan konfigurasi server baru, bukan file konfigurasi yang otomatis dibaca aplikasi saat ini.
