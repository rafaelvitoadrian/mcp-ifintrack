# Kontrak integrasi

## Login dan sesi

POST login memakai `application/x-www-form-urlencoded` dengan field `email` dan `password`. Field email pada client menerima identitas login. Token hasil login disimpan oleh host/server secara terisolasi per pengguna, tidak dikembalikan ke model sebagai hasil tool.

Gunakan Bearer token ke backend utama, verifikasi principal melalui `/api/v1/akunkeuangan/test`, lalu baca `fetchAuthorizedPermissionProfiles`. Jangan mempercayai username, role atau owner ID yang dimasukkan model. Jangan memakai satu token global untuk semua sesi.

Untuk request melalui proxy UI, tambahkan `x-akun-target` dan prefix `/__akun` pada path backend. Untuk server MCP yang mengakses backend langsung, prefix/header proxy tidak diperlukan. Batasi tujuan pada konfigurasi pengelola; jangan membuat tool HTTP bebas.

## Encoding

| Operasi | Encoding |
| --- | --- |
| Login | Form-urlencoded |
| Create/update rekening, kategori, transaksi, user | JSON |
| Create/update role dan permission profile | Form-urlencoded, key bertingkat |
| Change password | JSON |
| Upload | Multipart; biarkan library membentuk boundary |
| Schedule trigger/force/repeat | JSON object event terbaru |

## Lifecycle rekening dan user

- Create tidak mengirim `lifecycleEntity.identEntity`.
- Create menyertakan `lifecycleEntity.activationType.identActivationType` sesuai kontrak; client memakai default 1.
- Create rekening memerlukan `accountType`. Saldo, nomor rekening, dan pemilik ditentukan backend.
- Update membaca record terbaru dan menyertakan `lifecycleEntity.identEntity`, revisi yang tersedia, serta activationType yang valid.
- Jangan mengganti identitas lifecycle dengan `id` top-level semata.
- Field datetime lifecycle dan transaksi tidak boleh disamakan sembarang; gunakan serializer per endpoint dari repo asal.
- Detail HTTP 200 dengan body kosong berarti tidak ditemukan, bukan record valid.

## Users dan profile

Pembuatan user dapat menyertakan profile individual inline pada JSON Users, sehingga tidak perlu membuat profile terpisah terlebih dahulu. Profile baru memakai `identPermissionProfile: 0` dan role ID yang berasal dari API.

Update individual pada alur Users memakai ID profile existing dan identitas pemilik yang valid. Backend dapat menghasilkan profile/revisi pengganti; baca ulang user dan verifikasi role IDs hasil akhir, jangan hanya mengandalkan status 200. Jangan selalu memaksa ID profile menjadi 0 untuk setiap edit.

Perubahan assignment profile existing berbeda dari perubahan isi role profile. Gunakan pembentuk `Payload.userCreate/userUpdate`, `permissionProfileForm`, `permissionProfileUpdateForm`, `userRoleForm` dan alur verifikasi repo asal sebagai acuan.

Form role menggunakan key seperti:

```text
identUserRole=<id untuk update>
shortname=<shortname>
name=<name>
description=<description>
activationStatus=Active
userRoleFunctions[0].function.identFunction=<function id>
userRoleFunctions[0].function.functionName=<function name>
userRoleFunctions[0].accessLevel.identAccessLevel=<access id>
```

Pertahankan metadata auth level function jika kontrak memerlukannya. Auth level dan access level berbeda. Resolve ID access level dari API `getAccessLevels`, bukan menebak bahwa View selalu ID tertentu.

Form profile memakai `name`, `userRoles[0].identUserRole` dan metadata role yang sesuai. Update menambahkan `identPermissionProfile` serta referensi pemilik jika diperlukan. Array form memakai indeks dan dot notation, bukan JSON string pada field array.

Delete user hanya diizinkan backend untuk future-ready revision dengan effective-from kosong. Periksa record terbaru dan aturan persister; jangan menghapus master secara paksa atau mengubah database untuk melewati validasi.

## Angka dan data lengkap

Gunakan desimal untuk agregasi finansial. `jenis=1` berarti pemasukan dan `jenis=2` pengeluaran, tetapi aturan laporan kategori harus tetap dibedakan dari direction transaksi sesuai tool yang dibuat.

Sebutkan rentang tanggal, timezone, rekening dan status kelengkapan. Pagination hasil MCP tidak mengurangi data yang diunduh jika endpoint backend masih mengirim seluruh array. Jika satu rekening gagal dibaca, jangan menyebut subtotal sebagai total semua rekening. Pastikan kontrak pagination/agregasi backend nyata sebelum mengklaim dukungan.

## Approval dan error

Tool tulis harus memakai preview dan keputusan host/pengguna, terikat pada sesi, target, argumen dan snapshot. Jangan percaya argumen `confirmed: true` yang dibuat model. Annotations MCP hanya metadata, bukan kontrol keamanan.

Jangan otomatis retry mutasi setelah timeout atau koneksi terputus. Status hasil bisa belum diketahui; baca ulang sebelum meminta eksekusi baru. Deduplikasi proses lokal tidak menjamin exactly-once lintas restart/isolate.

Tangani HTML ngrok/proxy, JSON rusak, status non-2xx, body kosong, cancellation dan data terpotong. Redaksi password, hash, salt, token, authorization dan secrets dari hasil API dan log.

## Daily Schedule

Service mempunyai host sendiri. Client saat ini membentuk header `user` dari username terverifikasi dan `filter` berisi Participant serta Effective*Ident; header roles mengikuti kontrak service lama. Jangan mempercayai header buatan pengguna sebagai bukti izin. Validasi otorisasi di server MCP sebelum menjembatani service tersebut dan verifikasi kebutuhan header dengan pengelola backend.

List tertentu memakai format descriptor dan baris dipisah TAB pada `text/plain`. Jangan memecah berdasarkan koma, karena nilai dapat mengandung koma. Detail event perlu object JSON. Trigger, force dan repeat membawa event lengkap terbaru, bukan payload ID yang dikarang.

## MCP existing

Prefix UI: `POST /__akun/ai/mcp`.

```http
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer <backend-token>
x-akun-target: <backend-origin>
MCP-Protocol-Version: 2025-11-25
```

Implementasi repo menerima `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Transport mengembalikan JSON; GET/SSE tidak disediakan. Ini integrasi first-party dengan pemeriksaan Origin dan Bearer backend, belum merupakan remote OAuth server untuk sembarang client.

Tools existing: `get_context`, `prepare_action`, `create_account`, `update_account`, `create_category`, `update_category`, `create_transaction`, `update_transaction`.

Sesudah prepare, metadata approval diisi host sesuai preview: `fingerprint`, `expiresAt`, `requestId`. Model tidak mengeluarkan keputusan approval. Baca implementasi asli untuk detail fingerprint dan pemeriksaan snapshot; contoh JSON saja bukan pengganti protokol lengkap.
