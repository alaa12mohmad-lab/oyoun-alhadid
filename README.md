# عيون الحديد — نظام متابعة المعدات

نظام ويب لمتابعة دوام المعدات المستأجرة، يشمل إدارة المواقع والموردين وتقارير التكاليف الأسبوعية.

---

## 🚀 خطوات الرفع على GitHub Pages

### 1. إنشاء Firebase Project
1. اذهب إلى [console.firebase.google.com](https://console.firebase.google.com)
2. أنشئ مشروع جديد
3. فعّل **Authentication** → Sign-in method → Email/Password
4. فعّل **Firestore Database** → Start in production mode
5. من إعدادات المشروع → Web App → انسخ firebaseConfig

### 2. ضع بيانات Firebase
افتح الملف `src/firebase.js` وضع بياناتك:
```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
}
```

### 3. إنشاء أول مستخدم (مدير)
في Firebase Console → Authentication → Add user:
- أضف البريد وكلمة المرور

ثم في Firestore → collection: `users` → document بنفس UID:
```json
{
  "name": "المدير",
  "email": "admin@company.com",
  "role": "admin"
}
```

### 4. رفع Firestore Rules
في Firebase Console → Firestore → Rules، انسخ محتوى `firestore.rules`

### 5. رفع على GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/USERNAME/oyoun-alhadid.git
git push -u origin main
```

### 6. تفعيل GitHub Pages
في repository settings → Pages → Source: **GitHub Actions**

عند كل push على `main`، يتم البناء والرفع تلقائياً.

**الرابط:** `https://USERNAME.github.io/oyoun-alhadid/`

---

## 📋 هيكل الصلاحيات

| الصلاحية | الوصول |
|----------|--------|
| **مدير** | كل شيء: معدات، مواقع، موردين، مستخدمين، تقارير |
| **مشرف** | تسجيل دوام موقعه فقط + تقارير موقعه |
| **مشاهد** | تقارير فقط (قراءة) |

---

## 📊 التقرير الأسبوعي يشمل
- إجمالي ساعات + تكلفة كل معدة
- مقارنة المواقع مع نسب مئوية
- تقرير لكل مورد
- تصدير Excel (4 ورقات: المعدات، المواقع، الموردون، التفاصيل)

---

## 🗂️ Collections في Firestore
```
users       → uid, name, email, role, siteId, siteName
sites       → name, location, manager, notes
suppliers   → name, phone, contactPerson, notes
equipment   → name, type, siteId, siteName, supplierId, supplierName, hourlyRate, notes
logs        → equipmentId, equipmentName, siteId, siteName, supplierId, supplierName,
              hourlyRate, hours, date, notes, supervisorId, supervisorName
```
