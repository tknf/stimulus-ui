import { Application } from "@hotwired/stimulus";

import { installEventLog } from "./event_log";
import { registerAll } from "./register";

const application = Application.start();

registerAll(application);

const main = document.querySelector<HTMLElement>("main");

if (main !== null) installEventLog(main);
