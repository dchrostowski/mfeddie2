Malfunctioning Eddie

Headless browsing for crawlers.
Dependencies:
- PhantomJS (put binary in PATH)
- NodeJS
- npm

npm package dependencies:

phantomjs-node - https://github.com/sgentle/phantomjs-node

npm install phantom
<h2>About</h2>
Disclaimer: mfeddie is a little buggy and the javascript could probably be written better.
mfeddie leaks memory and kills itself when it utilizes x % of the system memory.  This will
drop all mfeddie browsers and in-process requests.

<h3>mf_server.js</h3>Listens for web traffic with instructions included in either the request
headers or query params.  This is where MFEddie browser instances are spawned, delegated,
and killed (usually).

<h3>mf_eddie.js</h3>The MFEddie headless browser class.  Probably the most interesting class.
This class is the prototype for headless browser objects which are spawned and killed
by mf_server.js or mf_instances.js.  mfeddie is basically a faux web browser which 
utilizes PhantomJS.  It is driven by web requests that come in through
mf_server.js.  mf_server.js will forward instructions and commands to the headless browser,
such as visit, wait, click, render, get_content.

<h3<mf_instances.js</h3>
This is where mfeddie browser instances are stored.  mf_instances.js puts a time limit
on how long an mfeddie instance may site idle in memory.  This is necessary because mfeddie
uses a lot of memory executing javascript.  If
an mfeddie browser stands idle for too long (default 2 minutes) mf_instances 
will kill it.  <b>You should not rely on letting mf_instances kill your mfeddie browsers when 
youre done with them.  You should kill your discarded browsers yourself by 
setting mf-action to kill or setting the mf-keep-alive option to 0 on your last request, 
making sure to include mf-pid to identify the correct browser..</b> Being lazy and letting the browser 
expire on its own is a waste of memory that could have otherwise been used for other requests.

mf_instances is also responsbile for killing the entire system when it begins
eating up too much system memory. This is a bad workaround for a memory leak problem
probably caused by poor code and way too many callback functions.
When mf_instances terminates, everything all requests are dropped and crawlers waiting on
responses will either timeout or throw errors.  Afterward, mfeddie should immediately
respawn.


<h2>How to use</h2>

1. startup mfeddie:<br/>
<i>node mf_server.js</i>

2. Send instrunctions, spawn browsers, and scrape content.

<h2>Examples using cURL</h2>

<h4>Visit page, dump headers to file</h4>
dan@mail:~$ curl --dump-header resp_headers.txt localhost:8315 --header "mf-action: visit" --header "mf-url: http://google.com" --header "mf-keep-alive: 1" --header "mf-user-agent: Mozilla..." --header "mf-proxy: 46.29.155.79:80" 
Output: {"status":"OK","message":"Successfully visited page."}dan@mail:~$ 
Output file: resp_headers.txt

<h4>Check for the browser pid in the header dump</h4>
dan@mail:~$ cat resp_headers.txt 
HTTP/1.1 200 OK
Content-Type: application/json
Set-Cookie: pid=25963; path=/mfeddie
Date: Mon, 06 Feb 2017 21:41:37 GMT
Connection: keep-alive
Transfer-Encoding: chunked

<h4>Plugin the mf-pid header to reclaim the browser you spawned in step 1 and get content</h4>
dan@mail:~$ curl --dump-header resp_headers.txt localhost:8315 --header "mf-pid: 25963" --header "mf-action: get_content" --header "mf-keep-alive: 0" --header "mf-user-agent: Mozilla..." --header "mf-proxy: 46.29.155.79:80" > out.html 
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100 49340    0 49340    0     0  60606      0 --:--:-- --:--:-- --:--:-- 60614
<br/><br/>
<b>Note:</b> the use of two separate requests for simply fetching a page is not necessary.  
It was demonstrated in this way to illustrate how to reclaim and drive the browser 
to do other actions.  To see a full list of commands that mfeddie supports, see
config.json in the config directory.  Here is a simpler example to acheive the same thing:<br/>

curl --dump-header resp_headers.txt localhost:8315 --header "mf-action: visit" --header "mf-url: http://google.com" --header "mf-keep-alive: 0" --header "mf-get-content: 1" --header "mf-user-agent: Mozilla..." --header "mf-proxy: 46.29.155.79:80" 
Output: entire web page with dynamically rendered content.
