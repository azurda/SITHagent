### SITHagent: Anti-cheat for Jedi Knight games

This project SITHagent is a proof of concept of an anti-cheat that emerged from a challenge: writing an anti-cheat without modding the client nor server-side. 

## Building



```sh
$ git clone git://github.com/azurda/sithagent.git
$ cd sithagent/
$ npm install
$ npm run build
```

Then launch a `linuxjampded` server and run:

`frida -l _agent.js linuxjampded`

Example output:

```yaml
player_die()
        clientId: 1
        ping: 48
        cmdTime: 154498757
        levelTime: 154498800
        timenudge: -36
```
