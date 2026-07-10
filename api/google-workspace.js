const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  const action = req.query.action;

  if (!['create', 'delete', 'cron'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Action tidak valid' });
  }

  if (action !== 'cron' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const dbUrl = process.env.FIREBASE_DATABASE_URL || "https://kreaverse-ai0107-default-rtdb.asia-southeast1.firebasedatabase.app";
    const dbSecret = process.env.FIREBASE_DATABASE_SECRET;

    async function logGSuiteAction(type) {
      try {
        const logUrl = `${dbUrl.replace(/\/$/, '')}/gsuite_logs/${Date.now()}.json?auth=${dbSecret}`;
        await fetch(logUrl, { method: 'PUT', body: JSON.stringify({ type, timestamp: Date.now() }) });
      } catch(e) {}
    }
    
    const configUrl = `${dbUrl.replace(/\/$/, '')}/settings/google_workspace.json?auth=${dbSecret}`;
    const credentialRes = await fetch(configUrl);
    if (!credentialRes.ok) throw new Error('Gagal mengambil konfigurasi Google Workspace dari database.');
    
    const config = await credentialRes.json();

    if (action === 'cron') {
      const savedCronSecret = config ? config.cronSecret : null;
      const envCronSecret = process.env.CRON_SECRET;
      const validSecret = savedCronSecret || envCronSecret; 
      if (req.headers.authorization !== `Bearer ${validSecret}`) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Cron Secret Salah' });
      }
    }

    if (!config || !config.accounts || config.accounts.length === 0) {
      if (action === 'cron') return res.status(200).json({ success: false, message: 'Konfigurasi belum diset.' });
      throw new Error('Belum ada Akun Admin Workspace yang ditambahkan.');
    }

    // Helper untuk mendapatkan JWT Client berdasarkan adminEmail
    function getJwtClient(adminEmail) {
      const account = config.accounts.find(a => a.adminEmail === adminEmail);
      if (!account) return null;
      const serviceAccount = JSON.parse(account.serviceAccountJson);
      return new google.auth.JWT(
        serviceAccount.client_email, null, serviceAccount.private_key,
        ['https://www.googleapis.com/auth/admin.directory.user'], adminEmail
      );
    }

    // ==========================================
    // ACTION 1: CREATE USER (POOLING 30 LIMIT)
    // ==========================================
    if (action === 'create') {
      const { firstName, lastName, email, password, duration } = req.body;
      if (!firstName || !lastName || !email || !password) return res.status(400).json({ success: false, message: 'Semua kolom input wajib diisi!' });

      // Cek pemakaian per akun
      const emailsUrl = `${dbUrl.replace(/\/$/, '')}/google_temp_emails.json?auth=${dbSecret}`;
      const emailsRes = await fetch(emailsUrl);
      const activeEmails = await emailsRes.json() || {};
      
      const usageMap = {};
      for (const key in activeEmails) {
          const em = activeEmails[key];
          if (em.adminEmail) usageMap[em.adminEmail] = (usageMap[em.adminEmail] || 0) + 1;
      }

      // Cari akun yang masih kosong (< 30)
      let selectedAccount = null;
      for (const acc of config.accounts) {
          const usage = usageMap[acc.adminEmail] || 0;
          if (usage < 30) {
              selectedAccount = acc;
              break;
          }
      }

      if (!selectedAccount) {
          return res.status(400).json({ success: false, message: 'Semua akun Workspace penuh (Limit 30/akun tercapai). Mohon tunggu yang lain kedaluwarsa.' });
      }

      const jwtClient = getJwtClient(selectedAccount.adminEmail);
      const directory = google.admin({ version: 'directory_v1', auth: jwtClient });

      // PROSES PEMBUATAN AKUN + INJEKSI ID KARYAWAN UNTUK BYPASS LOGIN
      await directory.users.insert({
        requestBody: {
          primaryEmail: email,
          name: { givenName: firstName, familyName: lastName },
          password: password,
          changePasswordAtNextLogin: false,
          organizations: [
            {
              primary: true,
              employeeId: '123456' // STRUKTUR YANG BENAR: Kode Sakti ID Karyawan
            }
          ]
        }
      });

      let durationInMinutes = 1440; 
      if (duration) durationInMinutes = parseInt(duration);

      const createdAt = Date.now();
      const expiresAt = createdAt + (durationInMinutes * 60 * 1000);
      const sanitizedKey = email.replace(/[@.]/g, '_');

      const saveUrl = `${dbUrl.replace(/\/$/, '')}/google_temp_emails/${sanitizedKey}.json?auth=${dbSecret}`;
      await fetch(saveUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName, lastName, createdAt, expiresAt, status: 'active', adminEmail: selectedAccount.adminEmail, lastLoginTime: null })
      });

      await logGSuiteAction('create');
      return res.status(200).json({ success: true, message: 'Akun Google Workspace berhasil dibuat!' });
    }

    // ==========================================
    // ACTION 2: DELETE USER
    // ==========================================
    if (action === 'delete') {
      const { email } = req.body;
      if (!email) return res.status(400).json({ success: false, message: 'Email wajib disertakan!' });

      const sanitizedKey = email.replace(/[@.]/g, '_');
      const getUrl = `${dbUrl.replace(/\/$/, '')}/google_temp_emails/${sanitizedKey}.json?auth=${dbSecret}`;
      const getRes = await fetch(getUrl);
      const emailData = await getRes.json();

      if (emailData && emailData.adminEmail) {
          const jwtClient = getJwtClient(emailData.adminEmail);
          if (jwtClient) {
              const directory = google.admin({ version: 'directory_v1', auth: jwtClient });
              try {
                await directory.users.delete({ userKey: email });
              } catch (apiErr) {
                if (apiErr.code !== 404 && !(apiErr.message && apiErr.message.includes('Not Found'))) {
                  return res.status(500).json({ success: false, message: `Gagal menghapus di Google: ${apiErr.message}` });
                }
              }
          }
      }

      const deleteUrl = `${dbUrl.replace(/\/$/, '')}/google_temp_emails/${sanitizedKey}.json?auth=${dbSecret}`;
      await fetch(deleteUrl, { method: 'DELETE' });

      await logGSuiteAction('delete');
      return res.status(200).json({ success: true, message: 'Akun Google Workspace berhasil dihapus!' });
    }

    // ==========================================
    // ACTION 3: CRON CLEANUP
    // ==========================================
    if (action === 'cron') {
      const emailsUrl = `${dbUrl.replace(/\/$/, '')}/google_temp_emails.json?auth=${dbSecret}`;
      const emailsRes = await fetch(emailsUrl);
      const emails = await emailsRes.json();

      if (!emails) return res.status(200).json({ success: true, message: 'Tidak ada email G Suite untuk dibersihkan.' });

      const now = Date.now();
      let deletedCount = 0;

      for (const key in emails) {
        const item = emails[key];
        
        const jwtClient = getJwtClient(item.adminEmail);
        if (!jwtClient) continue; // Skip jika akun admin sudah dihapus
        const directory = google.admin({ version: 'directory_v1', auth: jwtClient });

        if (item.expiresAt < now) {
          let canDeleteFirebase = false;
          try {
            await directory.users.delete({ userKey: item.email });
            canDeleteFirebase = true;
          } catch (err) {
            if (err.code === 404 || (err.message && err.message.includes('Not Found'))) {
              canDeleteFirebase = true;
            }
          }
          
          if (canDeleteFirebase) {
            const deleteUrl = `${dbUrl.replace(/\/$/, '')}/google_temp_emails/${key}.json?auth=${dbSecret}`;
            await fetch(deleteUrl, { method: 'DELETE' });
            await logGSuiteAction('delete');
            deletedCount++;
          }
        } else {
          try {
            const userRes = await directory.users.get({ userKey: item.email });
            const lastLoginTime = userRes.data.lastLoginTime;
            if (lastLoginTime && lastLoginTime !== item.lastLoginTime) {
              const updateUrl = `${dbUrl.replace(/\/$/, '')}/google_temp_emails/${key}/lastLoginTime.json?auth=${dbSecret}`;
              await fetch(updateUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(new Date(lastLoginTime).getTime())
              });
            }
          } catch (err) {}
        }
      }
      return res.status(200).json({ success: true, message: `Pembersihan selesai. Menghapus ${deletedCount} email.` });
    }

  } catch (error) {
    console.error('API Error:', error);
    let errorMsg = error.message || 'Terjadi kesalahan sistem.';
    if (error.errors && error.errors[0]) errorMsg = error.errors[0].message;
    return res.status(500).json({ success: false, message: errorMsg });
  }
};