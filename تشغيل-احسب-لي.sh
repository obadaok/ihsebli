#!/bin/bash
cd "$(dirname "$0")"
echo "======================================"
echo "   احسب لي - وضع التطوير المحلي"
echo "   (إعادة تشغيل تلقائية عند التعديل)"
echo "======================================"

# إيقاف أي نسخة سابقة من السيرفر لمنع تعارض الجلسة (440)
if pgrep -f "src/index.ts" > /dev/null || pgrep -f "dist/index.js" > /dev/null; then
  echo "يتم إيقاف النسخة القديمة من السيرفر..."
  pkill -f "src/index.ts"
  pkill -f "dist/index.js"
  sleep 2
fi

echo ""
echo "افتح صفحة QR في المتصفح:  http://localhost:3000"
echo "ثم امسح الرمز من واتساب (الإعدادات ← الأجهزة المرتبطة)"
echo "======================================"
sleep 2
xdg-open "http://localhost:3000" 2>/dev/null

PORT=3000 npm run dev
echo ""
echo "تم إيقاف السيرفر."
read -p "اضغط أي زر للإغلاق..."
