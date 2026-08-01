#!/bin/bash
cd "$(dirname "$0")"
echo "======================================"
echo "   احسب لي - جاري تشغيل السيرفر"
echo "======================================"

# إيقاف أي نسخة سابقة من السيرفر لمنع تعارض الجلسة (440)
if pgrep -f "dist/index.js" > /dev/null; then
  echo "يتم إيقاف النسخة القديمة من السيرفر..."
  pkill -f "dist/index.js"
  sleep 2
fi

npm run build
if [ $? -ne 0 ]; then
  echo "فشل البناء. تحقق من الأخطاء أعلاه."
  read -p "اضغط أي زر للإغلاق..."
  exit 1
fi

npm start
echo ""
echo "تم إيقاف السيرفر."
read -p "اضغط أي زر للإغلاق..."
