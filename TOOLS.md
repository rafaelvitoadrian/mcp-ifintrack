# Usulan tools MCP

Ini rancangan tools server baru, bukan klaim bahwa seluruh nama tersebut sudah tersedia. Semua path merujuk ENDPOINTS.md. Hindari tool serbaguna yang menerima method/path/URL bebas.

| Tool | API/implementasi | Sifat |
| --- | --- | --- |
| `list_accounts` | GET akunkeuangan | Baca |
| `get_account` | GET akunkeuangan/{id} | Baca |
| `list_categories` | GET category/lists + idAkun | Baca |
| `get_category` | GET category/detail + idAkun/idC | Baca |
| `list_transactions` | GET transaksikeuangan/lists + idAkun | Baca |
| `get_transaction` | GET transaksikeuangan/detail + idAkun/idTk | Baca |
| `get_spending_summary` | Baca data lengkap terotorisasi + agregasi desimal server | Baca |
| `list_users`, `get_user` | GET user, user/{id}; redaksi kredensial | Baca berizin |
| `list_roles`, `search_roles` | fetchUserRoles, getUserRoles/{pattern} | Baca berizin |
| `list_permission_functions` | getAllPermissionFunctions | Baca berizin |
| `list_access_levels`, `list_auth_levels` | getAccessLevels, getAuthLevels | Baca berizin |
| `get_authorized_permission_profiles` | fetchAuthorizedPermissionProfiles | Baca sesi sendiri |
| `search_audit_events`, `get_audit_entries` | event/events, event/evententries | Baca berizin + redaksi |
| `list_scheduled_events`, `get_scheduled_event` | Schedule list/detail pada host terpisah | Baca berizin |
| `create_account`, `update_account` | POST/PUT akunkeuangan | Mutasi + preview/approval |
| `create_category`, `update_category` | POST/PUT category | Mutasi + preview/approval |
| `create_transaction`, `update_transaction` | POST/PUT transaksikeuangan | Mutasi + preview/approval |
| `create_user`, `update_user` | POST/PUT user | Administratif + preview/approval |
| `create_role`, `update_role` | POST create-user-role / PUT update-user-role | Administratif + preview/approval |
| `create_permission_profile`, `update_permission_profile` | POST/PUT profile endpoints | Administratif + preview/approval |
| `change_user_password` | POST change-password | Sensitif; gunakan input rahasia host, bukan percakapan model |
| `delete_user_revision` | DELETE user/{revisionId} setelah validasi | Destruktif + approval |
| `upload_file` | POST fileupload/{folder} | Efek bergantung import; approval dan sumber file dibatasi |
| `replay_settlement` | GET integration | Mutasi meskipun GET; approval |
| `trigger_scheduled_event` | POST triggerEvent | Mutasi + approval |
| `force_scheduled_event` | POST forcedRun | Mutasi dengan izin force + approval |
| `repeat_scheduled_event` | POST repeat | Mutasi + approval |

Implementasikan baca keuangan terlebih dahulu, kemudian mutasi keuangan dan administrasi sesuai kebutuhan. Login lebih baik menjadi mekanisme koneksi host/server; hindari tool login yang membuat model menerima password.

Tools baca diberi `readOnlyHint: true` hanya jika benar-benar tidak menulis. Tools tulis diberi annotations sesuai perilaku nyata; tetap terapkan izin dan approval di implementasi. Jangan mendeklarasikan idempotent bila backend tidak menjaminnya.
