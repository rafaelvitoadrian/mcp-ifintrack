# Referensi MCP Financial Tracker

Folder ini dapat disalin sendiri ke repository atau laptop lain sebagai bahan implementasi MCP. Isinya dokumentasi dan contoh, bukan server MCP siap dijalankan.

Snapshot: 6 November 2026. Endpoint diambil dari client aplikasi, bukan hasil pemeriksaan backend langsung pada tanggal tersebut. Cocokkan lagi dengan backend tujuan sebelum implementasi.

## Isi

| File | Kegunaan |
| --- | --- |
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
