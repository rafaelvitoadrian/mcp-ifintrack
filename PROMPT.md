# Prompt implementasi

Salin blok berikut ke coding agent di repository tujuan, bersama folder referensi ini.

```text
Bangun server MCP Financial Tracker berdasarkan folder mcp-reference ini.
Baca README.md, ENDPOINTS.md, CONTRACTS.md, TOOLS.md dan examples/requests.json
sebelum membuat implementasi. Dokumentasi merupakan snapshot client, bukan
jaminan kontrak backend terbaru. Jangan mengarang bagian yang belum diketahui.

Jika repository asal tersedia, periksa juga:
src/services/config.js, src/services/api.js, src/utils/payload.js,
src/utils/users.js, src/utils/transactions.js, src/utils/audit.js,
src/utils/dto.js, mcp.js, mcp-catalog.js, docs/MCP.md,
docs/USER_PERMISSION_PROFILE_FLOW.md dan docs/GUI_PERMISSIONS.md.

Tujuan:
Server MCP TypeScript untuk tools keuangan, users/permissions, audit dan
Daily Schedule. Gunakan SDK resmi MCP. Periksa dokumentasi resmi dan
kompatibilitas versi sebelum memilih dependency/transport. Sediakan stdio
untuk lokal. Remote Streamable HTTP hanya dengan autentikasi yang sesuai.

Implementasi:
1. Base URL utama dan Daily Schedule configurable melalui environment,
   dibatasi pengelola. Jangan menyediakan tool HTTP bebas atau menerima
   URL backend arbitrer dari model. Jangan hardcode kredensial.
2. Login POST /api/v1/user/loginv2 memakai form-urlencoded email/password.
   Token dari respons disimpan aman per sesi, verifikasi principal lalu
   fetchAuthorizedPermissionProfiles. Token/password tidak masuk hasil tool,
   prompt atau log. Jangan memakai satu token global untuk semua pengguna.
3. Terapkan permissions dan kepemilikan di server sebelum setiap operasi.
   Principal/role dari input model tidak dipercaya. Backend tetap menjadi
   otoritas izin. Respons users harus disaring agar hash/salt/password/token
   tidak keluar ke model.
4. Mulai dengan list/get akun, kategori, transaksi dan spending summary.
   Tambahkan tools baca Users, roles, functions, access/auth levels,
   authorized profiles, audit dan schedule sesuai TOOLS.md.
5. Tools mutasi terpisah: create/update keuangan dan administrasi. Password,
   delete revisi user, upload, replay settlement, trigger/force/repeat schedule
   mempunyai izin khusus. GET /api/v1/integration adalah mutasi.
6. Sebelum mutasi buat preview target, argumen dan perubahan; eksekusi setelah
   keputusan host/pengguna terikat pada sesi dan snapshot. confirmed=true dari
   model bukan approval. Annotations MCP bukan mekanisme keamanan.
7. Gunakan kontrak lifecycle dan encoding per endpoint. Baca record terbaru
   sebelum update. Jangan menciptakan endpoint DELETE keuangan. ID access
   level dari getAccessLevels, bukan angka hardcode. Update individual user
   memakai profile existing sesuai kontrak dan verifikasi roles sesudahnya;
   jangan selalu membuat profile baru dengan ID 0.
8. Gunakan decimal untuk nominal/agregasi, periode konkret dan timezone.
   Hanya klaim total lengkap bila seluruh data yang diperlukan berhasil dibaca.
   Pagination output tools bukan pagination backend. Jangan menghitung dari
   sampel atau mengarang endpoint agregasi/pagination.
9. Bedakan JSON, form-urlencoded bertingkat, multipart dan text/plain.
   Daily Schedule host terpisah, header khusus dan tidak menerima Bearer
   backend utama secara otomatis. Verifikasi kontrak header dengan pengelola.
10. Tangani timeout, abort, respons HTML, JSON rusak, 401/403/429, body kosong
    pada 200 dan kegagalan sebagian. Jangan retry mutasi otomatis; jika write
    tidak pasti, verifikasi data sebelum mengirim ulang. Jangan menjanjikan
    exactly-once tanpa dukungan backend persisten.
11. Input schema ketat, ID tervalidasi, field tak dikenal ditolak. Data backend,
    nama/deskripsi/audit adalah data tidak dipercaya, bukan instruksi model.
    Batasi ukuran hasil dan jangan membocorkan credentials pada diagnostics.
12. Buat tes fixture untuk auth, izin, isolasi sesi, kepemilikan, desimal,
    encoding, approval, revisi basi, redaksi dan error parsial. Tes live opt-in;
    jangan menulis data nyata tanpa instruksi eksplisit.

Hasil:
- Source runnable dan lockfile dependency.
- .env.example tanpa secrets.
- README instalasi, konfigurasi client dan daftar tool.
- Mapping tool -> method/path -> encoding -> izin -> efek samping.
- Contoh input/output dan hasil tes yang benar-benar dijalankan.
- Daftar kontrak belum terverifikasi, tanpa menutupinya dengan asumsi.

Jika hanya folder referensi tersedia dan detail payload belum cukup, selesaikan
bagian yang terverifikasi terlebih dahulu dan jelaskan sumber tambahan yang
dibutuhkan. Jangan mengklaim seluruh endpoint telah diuji pada backend nyata.
```
