const fs = require('fs');

function replaceFile(path, search, replace) {
  if (fs.existsSync(path)) {
    const data = fs.readFileSync(path, 'utf8');
    fs.writeFileSync(path, data.replace(search, replace));
  }
}

replaceFile('backend/src/services/push.ts', 
  "import { webpush, setVapidDetails } from 'webpush';", 
  "import webpush from 'web-push';\nconst { setVapidDetails } = webpush;"
);

['email.ts', 'in-app.ts', 'sms.ts'].forEach(file => {
  replaceFile(`backend/src/services/notifications/channels/${file}`, 
    "import { config } from '../../config.js';", 
    "import { config } from '../../../config.js';"
  );
});

['deliveryTracker.ts', 'preferenceService.ts', 'templateService.ts'].forEach(file => {
  replaceFile(`backend/src/services/notifications/${file}`, 
    "import { config } from '../config.js';", 
    "import { config } from '../../config.js';"
  );
});
