---
layout: post
title: "A deep dive into Linux namespaces, part 4"
categories: posts
excerpt: "Running processes in isolated network namespaces"
tags: [linux, namespaces, docker, container]
comments: true
share: true
---

<section id="table-of-contents" class="toc">
  <header>
    <h3>Overview</h3>
  </header>
<div id="drawer" markdown="1">
*  Auto generated table of contents
{:toc}
</div>
</section><!-- /#table-of-contents -->

In this final post of the series we take a look at [Network namespaces](http://man7.org/linux/man-pages/man8/ip-netns.8.html){:target="_blank"}.
As we hinted at during the [intro post]({{ site.baseurl }}{% post_url 2019-06-27-linux-namespaces-part-1 %}), a network namespace
isolates network related resources - a process running in a distinct network namespace has its own networking devices, routing tables, firewall rules etc.
We can see this in action immediately by inspecting our current network environment.

## The ip Command ######

> Since we will be interacting with network devices in this post, we will re-enforce the superuser requirements that we relaxed in the previous posts. From now on, we will assume that both `ip` and `isolate` are being run with `sudo`.

{% highlight bash %}
$ ip link list
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: ens33: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:0c:29:96:2e:3b brd ff:ff:ff:ff:ff:ff
{% endhighlight %}


Star of the show here is the `ip` command - the [Swiss Army Knife](https://access.redhat.com/sites/default/files/attachments/rh_ip_command_cheatsheet_1214_jcs_print.pdf){:target="_blank"} for networking in Linux - and we will use it extensively in this post.
Right now we have just run the `link list` subcommand to show us what networking devices are currently available in the system (here we have `lo`, the loopback interface and `ens33` an ethernet LAN interface).
\\
\\
As with all other namespaces, the system starts with an initial network namespace within to which all processes belong unless specified otherwise. Running this `ip link list` command as-is gives us the networking devices owned by the initial namespace (since our shell and the `ip` command belong to this namespace).


## Named Network Namespaces ######

Let's create a new network namespace:

{% highlight bash %}
$ ip netns add coke
$ ip netns list
coke
{% endhighlight %}

Again, we've used the `ip` command. Its `netns` subcommand allows us to play with network namespaces - for example we can create new network namespaces using the `add` subcommand of `netns` and use `list` to, well, list them.

You might notice that `list` only returned our newly created namespace - shouldn't it return at least two, the other one being the initial namespace that we mentioned earlier?
The reason for this is that `ip` creates what is called a *named network namespace*, which simply is a network namespace that is identifiable by a unique name (in our case `coke`).
Only named network namespaces are shown via `list` and the initial network namespace isn't named.
\\
\\
Named network namespaces are easier to get a hold of. For example, a file is created for each named network namespace under the `/var/run/netns` folder and can be used by a process that wants to switch to its namespace. Another property of named network namespaces is that they can exist without having any process as a member - unlike non-named ones that will be deleted once all member processes exit.
\\
\\
Now that we have a child network namespace, we can see networking from its perspective.

> We will be using the command prompt `C$` to emphasize a shell running inside a child network namespace.


{% highlight bash %}
$ ip netns exec coke bash
C$ ip link list
1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
{% endhighlight %}


The `exec $namespace $command` subcommand executes `$command` in the named network namespace `$namespace`.
Here we ran a shell inside the `coke` namespace and listed the network devices available. We can see that at least our `ens33` device has disappeared.
The only device that shows up is loopback and even that interface is down.


{% highlight bash %}
C$ ping 127.0.0.1
connect: Network is unreachable
{% endhighlight %}

We should be used to this by now, the default setup for namespaces are usually very strict. For network namespaces as we can see, no devices except `loopback` will be present.
We can bring the `loopback` interface up without any paperwork though:


{% highlight bash %}
C$ ip link set dev lo up
C$ ping 127.0.0.1
PING 127.0.0.1 (127.0.0.1) 56(84) bytes of data.
64 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.034 ms
...
{% endhighlight %}


## Network Isolation ######

We're already starting to see that by running a process in a nested network namespace like `coke`, we can be sure that it is isolated from the rest of the system as far as networking is concerned.
Our shell process running in `coke` can only communicate via `loopback` - this means that it can only communicate with processes that are also members of the `coke` namespace but currently there are no other member processes (and in the name of isolation, we would like that it remains that way) so it's a bit lonely.
Let's try to relax this isolation a bit, we will create a *tunnel* through which processes in `coke` can communicate with processes in our initial namespace.
\\
\\
Now, any network communication has to go via some network device and a device can exist in exactly one network namespace at any given time so communication between any two processes in different namespaces must go via at least two network devices - one in each network namespace.

#### Veth Devices ######

We will use a [**v**irtual **eth**ernet](http://man7.org/linux/man-pages/man4/veth.4.html){:target="_blank"} network device (or `veth` for short) to fulfill our need.
Veth devices are always created as a pair of devices in a tunnel-like fashion so that messages written to the device on one end comes out of the device on the other end.
You might guess that we could easily have one end in the initial network namespace and the other in our child network namespace and have all inter-network-namespace communication go via the respective veth end device (and you would be correct).

{% highlight bash %}
# Create a veth pair (veth0 <=> veth1)
$ ip link add veth0 type veth peer name veth1
# Move the veth1 end to the new namespace
$ ip link set veth1 netns coke
# List the network devices from inside the new namespace
C$ ip link list
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
7: veth1@if8: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN mode DEFAULT group default qlen 1000
    link/ether ee:16:0c:23:f3:af brd ff:ff:ff:ff:ff:ff link-netnsid 0
{% endhighlight %}

Our `veth1` device now shows up in the `coke` namespace. But to make the veth pair functional, we need to give them both IP addresses and bring the interfaces up. We will do this in their respective network namespace.

{% highlight bash %}
# In the initial namespace
$ ip addr add 10.1.1.1/24 dev veth0
$ ip link set dev veth0 up

# In the coke namespace
C$ ip addr add 10.1.1.2/24 dev veth1
C$ ip link set dev veth1 up

C$ ip addr show veth1
7: veth1@if8: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default qlen 1000
    link/ether ee:16:0c:23:f3:af brd ff:ff:ff:ff:ff:ff link-netnsid 0
    inet 10.1.1.2/24 scope global veth1
       valid_lft forever preferred_lft forever
    inet6 fe80::ec16:cff:fe23:f3af/64 scope link
       valid_lft forever preferred_lft forever
{% endhighlight %}

We should see that `veth1` is up and has our assigned address `10.1.1.2` - the same should happen for `veth0` in the initial namespace.
Now we should be able to do an inter-namespace ping between two processes running in both namespaces.

{% highlight bash %}
$ ping -I veth0 10.1.1.2
PING 10.1.1.2 (10.1.1.2) 56(84) bytes of data.
64 bytes from 10.1.1.2: icmp_seq=1 ttl=64 time=0.041 ms
...
C$ ping 10.1.1.1
PING 10.1.1.1 (10.1.1.1) 56(84) bytes of data.
64 bytes from 10.1.1.1: icmp_seq=1 ttl=64 time=0.067 ms
...
{% endhighlight %}

## Implementation ######

> The source code for this post [can be found here](https://github.com/iffyio/isolate/tree/part-4){:target="_blank"}.

As usual, we will now try to replicate what we've seen so far in code. Specifically, we will need to do the following:

1. Execute the command within a new network namespace.
2. Create a veth pair (veth0 <=> veth1).
3. Move the veth1 device to the new namespace.
4. Assign IP addresses to both devices and bring them up.

Step `1` is straight-forward, we create our command process in a new network namespace by adding the `CLONE_NEWNET` flag to `clone`:

{% highlight C %}
int clone_flags = SIGCHLD | CLONE_NEWUTS | CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWNET;
{% endhighlight %}

#### Netlink ######
For the remaining steps, we will primarily be using the [Netlink](http://www.infradead.org/~tgr/libnl/doc/core.html#_introduction){:target="_blank"} [interface](http://man7.org/linux/man-pages/man7/netlink.7.html){:target="_blank"} to communicate with Linux.
Netlink is primarily used for communication between regular applications (like `isolate`) and the Linux kernel.
It exposes an API on top of sockets, based on a [protocol](http://www.infradead.org/~tgr/libnl/doc/core.html#core_netlink_fundamentals){:target="_blank"} that determines message structure and content.
Using this protocol we can send messages that Linux receives and translates to requests - like *create a veth pair with names veth0 and veth1*.
\\
\\
Let's start by creating our netlink socket. In it, we specify that we want to use the `NETLINK_ROUTE` protocol - this protocol covers implementations for network routing and device management.

{% highlight C %}
int create_socket(int domain, int type, int protocol)
{
    int sock_fd = socket(domain, type, protocol);
    if (sock_fd < 0)
        die("cannot open socket: %m\n");

    return sock_fd;
}

int sock_fd = create_socket(
  PF_NETLINK, SOCK_RAW | SOCK_CLOEXEC, NETLINK_ROUTE);
{% endhighlight %}


#### Netlink Message Format ######

A Netlink [message](http://www.infradead.org/~tgr/libnl/doc/core.html#core_msg_format){:target="_blank"} is a 4-byte aligned block of data containing a header (`struct nlmsghdr`) and a payload. The header format is described [here](https://tools.ietf.org/html/rfc3549#section-2.3.2){:target="_blank"}. The [Network Interface Service (NIS) Module](https://tools.ietf.org/html/rfc3549#section-2.3.1){:target="_blank"} specifies the format (`struct ifinfomsg`) that payload related to network interface administration must begin with.
\\
\\
Our request will be represented by the following `C` struct:

{% highlight C %}
#define MAX_PAYLOAD 1024

struct nl_req {
    struct nlmsghdr n;     // Netlink message header
    struct ifinfomsg i;    // Payload starting with NIS module info
    char buf[MAX_PAYLOAD]; // Remaining payload
};
{% endhighlight %}

#### Netlink Attributes ######

The NIS module requires the payload to be encoded as [Netlink attributes](http://www.infradead.org/~tgr/libnl/doc/core.html#core_attr){:target="_blank"}.
Attributes provide a way to segment the payload into subsections.
An attribute has a type and a length in addition to a payload containing its actual data.
\\
\\
The Netlink message payload will be encoded as a list of attributes (where any such attribute can in turn have nested attributes) and we will have some helper functions to populate it with attributes.
In code, an attribute is represented by the `rtattr` struct in the `linux/rtnetlink.h` header file as:

{% highlight C %}
struct rtattr {
  unsigned short  rta_len;
  unsigned short  rta_type;
};
{% endhighlight %}

`rta_len` is the length of the attribute's payload which immediately follows the `rt_attr` struct in memory (i.e the next `rta_len` bytes).
How the content of this payload is interpreted is dictated by `rta_type` and possible values are entirely dependent on the receiver implementation and the request being sent.
\\
\\
In an attempt to put this all together, let's see how `isolate` makes a netlink request to create veth pair with the following function `create_veth` that fulfills step `2`:

{% highlight C %}
// ip link add ifname type veth ifname name peername
void create_veth(int sock_fd, char *ifname, char *peername)
{
    __u16 flags =
            NLM_F_REQUEST  // This is a request message
            | NLM_F_CREATE // Create the device if it doesn't exist
            | NLM_F_EXCL   // If it already exists, do nothing
            | NLM_F_ACK;   // Reply with an acknowledgement or error

    // Initialise request message.
    struct nl_req req = {
            .n.nlmsg_len = NLMSG_LENGTH(sizeof(struct ifinfomsg)),
            .n.nlmsg_flags = flags,
            .n.nlmsg_type = RTM_NEWLINK, // This is a netlink message
            .i.ifi_family = PF_NETLINK,
    };
    struct nlmsghdr *n = &req.n;
    int maxlen = sizeof(req);

    /*
     * Create an attribute r0 with the veth info. e.g if ifname is veth0
     * then the following will be appended to the message
     * {
     *   rta_type: IFLA_IFNAME
     *   rta_len: 5 (len(veth0) + 1)
     *   data: veth0\0
     * }
     */
    addattr_l(n, maxlen, IFLA_IFNAME, ifname, strlen(ifname) + 1);

    // Add a nested attribute r1 within r0 containing iface info
    struct rtattr *linfo =
            addattr_nest(n, maxlen, IFLA_LINKINFO);
    // Specify the device type is veth
    addattr_l(&req.n, sizeof(req), IFLA_INFO_KIND, "veth", 5);

    // Add another nested attribute r2
    struct rtattr *linfodata =
            addattr_nest(n, maxlen, IFLA_INFO_DATA);

    // This next nested attribute r3 one contains the peer name e.g veth1
    struct rtattr *peerinfo =
            addattr_nest(n, maxlen, VETH_INFO_PEER);
    n->nlmsg_len += sizeof(struct ifinfomsg);
    addattr_l(n, maxlen, IFLA_IFNAME, peername, strlen(peername) + 1);
    addattr_nest_end(n, peerinfo); // end r3 nest

    addattr_nest_end(n, linfodata); // end r2 nest
    addattr_nest_end(n, linfo); // end r1 nest

    // Send the message
    send_nlmsg(sock_fd, n);
}
{% endhighlight %}


As we can see, we need to be precise about what we send here - we had to encode the message in the exact way it will be interpreted by the kernel implementation and here it took us 3 nested attributes to do so.
I'm sure this is documented somewhere even though I was unable to find it after some googling - I mostly figured this out via [strace](https://linux.die.net/man/1/strace){:target="_blank"} and the `ip` command [source code](https://github.com/shemminger/iproute2/tree/master/ip){:target="_blank"}.
\\
\\
Next, for step `3`, is a method that, given an interface name `ifname` and a network namespace file descriptor `netns`, moves the device associated with that interface to the specified network namespace.

{% highlight C %}
// $ ip link set veth1 netns coke
void move_if_to_pid_netns(int sock_fd, char *ifname, int netns)
{
    struct nl_req req = {
            .n.nlmsg_len = NLMSG_LENGTH(sizeof(struct ifinfomsg)),
            .n.nlmsg_flags = NLM_F_REQUEST | NLM_F_ACK,
            .n.nlmsg_type = RTM_NEWLINK,
            .i.ifi_family = PF_NETLINK,
    };

    addattr_l(&req.n, sizeof(req), IFLA_NET_NS_FD, &netns, 4);
    addattr_l(&req.n, sizeof(req), IFLA_IFNAME,
              ifname, strlen(ifname) + 1);
    send_nlmsg(sock_fd, &req.n);
}
{% endhighlight %}

After creating the veth pair and moving one end to our target network namespace, step `4` has us assigning both end devices IP addresses and bringing their interfaces up.
For that we have a helper function `if_up` which, given an interface name `ifname` and ip address `ip`, assigns `ip` to the device `ifname` and brings it up.
For brevity we do not show those here but they can be found [here instead](https://github.com/iffyio/isolate/blob/part-4/netns.c#L155){:target="_blank"}.
\\
\\
Finally, we bring these methods together to prepare our network namespace for our command process.

{% highlight C %}
static void prepare_netns(int child_pid)
{
    char *veth = "veth0";
    char *vpeer = "veth1";
    char *veth_addr = "10.1.1.1";
    char *vpeer_addr = "10.1.1.2";
    char *netmask = "255.255.255.0";

    // Create our netlink socket
    int sock_fd = create_socket(
            PF_NETLINK, SOCK_RAW | SOCK_CLOEXEC, NETLINK_ROUTE);

    // ... and our veth pair veth0 <=> veth1.
    create_veth(sock_fd, veth, vpeer);

    // veth0 is in our current (initial) namespace
    // so we can bring it up immediately.
    if_up(veth, veth_addr, netmask);

    // ... veth1 will be moved to the command namespace.
    // To do that though we need to grab a file descriptor
    // to and enter the commands namespace but first we must
    // remember our current namespace so we can get back to it
    // when we're done.
    int mynetns = get_netns_fd(getpid());
    int child_netns = get_netns_fd(child_pid);

    // Move veth1 to the command network namespace.
    move_if_to_pid_netns(sock_fd, vpeer, child_netns);

    // ... then enter it
    if (setns(child_netns, CLONE_NEWNET)) {
        die("cannot setns for child at pid %d: %m\n", child_pid);
    }

    // ... and bring veth1 up
    if_up(vpeer, vpeer_addr, netmask);

    // ... before moving back to our initial network namespace.
    if (setns(mynetns, CLONE_NEWNET)) {
        die("cannot restore previous netns: %m\n");
    }

    close(sock_fd);
}
{% endhighlight %}

Then we can call `prepare_netns` right after we're done setting up the user namespace.

{% highlight C %}
    ...
    // Get the writable end of the pipe.
    int pipe = params.fd[1];

    prepare_userns(cmd_pid);
    prepare_netns(cmd_pid);

    // Signal to the command process we're done with setup.
    ...
{% endhighlight %}

Let's try it out!

{% highlight bash %}
$ sudo ./isolate sh
===========sh============
$ ip link list
1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
31: veth1@if32: <BROADCAST,MULTICAST,UP,LOWER_UP,M-DOWN> mtu 1500 qdisc noqueue state UP qlen 1000
    link/ether 2a:e8:d9:df:b4:3d brd ff:ff:ff:ff:ff:ff
# Verify inter-namespace connectivity
$ ping 10.1.1.1
PING 10.1.1.1 (10.1.1.1): 56 data bytes
64 bytes from 10.1.1.1: seq=0 ttl=64 time=0.145 ms
{% endhighlight %}
