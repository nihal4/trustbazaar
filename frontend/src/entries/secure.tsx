// secure.html: the credential screens of Unit 5, /secure/orders/{id}/key, /deliver and /credentials (SEC-GAM-03;
// section 3.1; U8-07). A minimal bundle: Unit 5's sealed.js and the plain modules of src/lib and src/secure, so no
// React, no features and no shared code (enforced by eslint.config.js).
import '../secure/secure.css';
import { start } from '../secure/main';

const root = document.getElementById('root');
if (root) void start(root);
