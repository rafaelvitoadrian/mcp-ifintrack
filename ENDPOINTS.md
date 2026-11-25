# Daftar endpoint

`API_BASE_URL` adalah origin backend utama yang ditentukan pengelola. `SCHEDULE_BASE_URL` adalah layanan Daily Schedule terpisah. Path berikut adalah path backend langsung, tanpa prefix proxy UI `/__akun`.

Kecuali login, health dan Daily Schedule, client memakai Bearer token sesi. Keberadaan endpoint tidak berarti semua pengguna berhak mengaksesnya.

## Autentikasi

| Method | Path | Kontrak |
| --- | --- | --- |
| POST | `/api/v1/user/loginv2` | Form-urlencoded: `email`, `password`; respons dibaca dari `token` |
| GET | `/api/v1/akunkeuangan/test` | Verifikasi sesi/principal |
| GET | `/api/v2/user/fetchAuthorizedPermissionProfiles` | Permissions pengguna yang login |
| GET | `/actuator/health` | Health; dapat lambat/gagal karena dependency backend |

Nama login v2 tetap memakai prefix `/api/v1`; jangan mengarang `/api/v2/user/login`.

## Rekening

| Method | Path | Tujuan/body |
| --- | --- | --- |
| GET | `/api/v1/akunkeuangan` | Daftar rekening |
| GET | `/api/v1/akunkeuangan/{id}` | Detail rekening |
| POST | `/api/v1/akunkeuangan` | Create, JSON dengan lifecycle |
| PUT | `/api/v1/akunkeuangan` | Update, JSON dengan identitas/revisi terbaru |

## Kategori

| Method | Path | Tujuan/body |
| --- | --- | --- |
| GET | `/api/v1/category/lists?idAkun={accountId}` | Daftar kategori rekening |
| GET | `/api/v1/category/detail?idAkun={accountId}&idC={categoryId}` | Detail |
| POST | `/api/v1/category` | Create, JSON |
| PUT | `/api/v1/category` | Update, JSON |

## Transaksi

| Method | Path | Tujuan/body |
| --- | --- | --- |
| GET | `/api/v1/transaksikeuangan/lists?idAkun={accountId}` | Daftar transaksi rekening |
| GET | `/api/v1/transaksikeuangan/detail?idAkun={accountId}&idTk={transactionId}` | Detail |
| POST | `/api/v1/transaksikeuangan` | Create, JSON |
| PUT | `/api/v1/transaksikeuangan` | Update, JSON |

Tidak ada kontrak DELETE rekening/kategori/transaksi dalam client saat ini. Endpoint agregasi total pengeluaran juga tidak tercantum; hitung melalui tool dari data lengkap yang sah.

## Users dan permission

| Method | Path | Kontrak |
| --- | --- | --- |
| GET | `/api/v2/user` | Daftar users; redaksi field kredensial sebelum hasil MCP |
| GET | `/api/v2/user/{id}` | Detail user |
| POST | `/api/v2/user` | Create, JSON |
| PUT | `/api/v2/user` | Update, JSON |
| DELETE | `/api/v2/user/{id}` | Hanya revisi yang memenuhi ketentuan backend, bukan sembarang master ID |
| POST | `/api/v2/user/change-password` | JSON: `identUser`, `newPassword` |
| GET | `/api/v2/user/fetchUserRoles` | Semua roles |
| GET | `/api/v2/user/getUserRoles/{pattern}` | Pola pencarian di-encode; client membungkus teks biasa dengan `*...*` |
| GET | `/api/v2/user/getAuthLevels` | Metadata auth levels |
| GET | `/api/v2/user/getAccessLevels` | Metadata access levels |
| GET | `/api/v2/user/getAllPermissionFunctions` | Katalog functions |
| POST | `/api/v2/user/create-user-role` | Form-urlencoded |
| PUT | `/api/v2/user/update-user-role` | Form-urlencoded |
| POST | `/api/v2/user/create-permission-profile` | Form-urlencoded |
| PUT | `/api/v2/user/update-permission-profile` | Form-urlencoded |

## Audit, upload dan integrasi

| Method | Path | Kontrak |
| --- | --- | --- |
| GET | `/event/eventtypes` | Metadata enum |
| GET | `/event/evententrynames` | Metadata enum |
| GET | `/event/events` | Query audit di bawah |
| GET | `/event/evententries?eventId={id}&limit={limit}` | Entries event |
| POST | `/fileupload/{folder}` | Multipart field `file`; header `filter` dan `roles` sesuai sesi/kontrak |
| GET | `/api/v1/integration` | **Mutasi: replay settlement**, memerlukan approval |

Query events: `eventId`, `userId`, `from`, `to`, `participantMainId`, `eventType`, `eventName`, `limit`, `entryData`, `entryName`, `entityType`, `entryBusinessId`.

Parameter kosong yang diwajibkan controller tetap dikirim. `eventType` dan `entryName` dikirim sebagai parameter berulang; pilihan kosong di UI berarti seluruh enum metadata, bukan sembarang string kosong. Tanggal dikonversi ke ISO UTC dari input valid. Ikuti pembentuk `auditEventsQuery` di repo asal.

## Daily Schedule: base URL terpisah

| Method | Path | Tujuan |
| --- | --- | --- |
| GET | `/dailyschedule/ping` | Readiness sebelum operasi lain |
| GET | `/dailyschedule/business-services` | Business services |
| GET | `/dailyschedule/daily-schedule-event-actions` | Actions |
| GET | `/dailyschedule/event/scheduled` | Daftar event |
| GET | `/dailyschedule/scheduledEvent/{id}` | Detail event |
| POST | `/dailyschedule/scheduledEvent/triggerEvent` | Trigger; body JSON event |
| POST | `/dailyschedule/scheduledEvent/triggerEvent/forcedRun` | Force run; body JSON event |
| POST | `/dailyschedule/scheduledEvent/repeat` | Repeat; body JSON event |

Query list: `_batch`, `_maxItems`, `_scheduleday` format `yyyyMMdd`, `Istatus` dipisah koma, `_business_service`.

Client tidak meneruskan Bearer backend utama ke service ini. Header `user`, `roles`, `filter` memiliki kontrak khusus; lihat CONTRACTS. Beberapa list mengembalikan tabel `text/plain`, detail event berupa object JSON. Jangan memaksakan Accept JSON pada seluruh endpoint.

## Endpoint aplikasi yang berbeda dari API backend

| Method | Path pada UI | Tujuan |
| --- | --- | --- |
| POST | `/__akun/ai/mcp` | MCP JSON-RPC yang sudah tersedia |
| GET | `/__akun/agent/config` | Status analisis baru Mastra |
| GET/POST | `/__akun/agent/threads` | Daftar/buat percakapan Mastra |
| GET | `/__akun/agent/threads/{id}` | History Mastra milik pengguna |
| POST | `/__akun/agent/chat` | Stream analisis Mastra |

Endpoint Mastra adalah transport aplikasi, bukan otomatis server MCP. Untuk tools keuangan baru, gunakan API backend dan kontrak izin, bukan memanggil chat LLM sebagai pengganti API.
