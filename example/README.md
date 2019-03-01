## Hole punching example

1. Create two linux VMs in VirtualBox and set their networking to NAT mode.

2. Upload this repo to the host and to both of the VMs

3. If your host IP address is 192.168.10.10, run this on the host:

```
> node example/tracker.js 192.168.10.10
```

4. Run on first VM:

```
env DEBUG="*" node example/server.js 192.168.10.10
```

5. Run on second VM:

```
env DEBUG="*" node example/client.js 192.168.10.10
```

6. You will see the VMs playing ping-pong even though they are both behind NAT

You can omit setting DEBUG env variable to make it less verbose
