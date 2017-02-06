Malfunctioning Eddie

Headless browsing for crawlers.
Dependencies:
- PhantomJS (put binary in PATH)
- NodeJS
- npm

npm package dependencies:

phantomjs-node - https://github.com/sgentle/phantomjs-node

npm install phantom

mf_server.js - Listens for web traffic with instructions included in either the request
headers or query params.  This is where MFEddie browser instances are spawned, delegated,
and killed (usually).

mfeddie.js - The MFEddie headless browser class.  Probably the most interesting class.
This class is the prototype for headless browser objects which are spawned and killed
by mf_server.js or mf_instances.js.  MFEddie is basically a faux web browser which 
utilizes PhantomJS's functionality.  It is driven by web requests that come in through
mf_server.js.  mf_server.js will forward instructions and commands to the headless browser,
such as visit, wait, click, render, get_content.

mf_instances.js - This is where mfeddie instances are stored.  mf_instances puts a time limit
on how long an mfeddie instance may exist in memory.  This is necessary because mfeddie
uses a lot of memory executing all the javascript out in the wild while browsing.  If
an mfeddie browser stands idle for too long (default 2 minutes, I think...) mf_instances 
will kill it.  ***DO NOT RELY ON MF_INSTANCES TO KILL YOUR MFEDDIE INSTANCES.  You should
kill them manually by issuing a request to mf_server.js with browser id and kill commandl

mf_instances is also responsbile for murder-suiciding the entire system when it starts
eating up too much system memory.  This is a flaw in the MfEddie system that never got worked
out.  When mf_instances pulls the trigger, all requests are dropped and crawlers waiting on
responses will either timeout or throw errors.  mfeddie should then automatically respawn immediately
kinda like Jesus, except mfeddie does it way faster than three days.
