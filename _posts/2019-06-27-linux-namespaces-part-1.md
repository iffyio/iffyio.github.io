---
layout: post
title: "A deep dive into Linux namespaces"
categories: posts
excerpt: "Running isolated processes using the namespace kernel primitive"
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

In this series of posts we will look closely at one of the main ingredients in a [container](https://www.docker.com/resources/what-container){:target="_blank"} - Namespaces.
In the process, we will create a simpler clone of the `docker run` command - our very own program that will take as input a command (along with it's arguments if any) and spin up a *container* process to run it, isolated from the rest of the system similar to how you would `docker run` it [from an image](https://docs.docker.com/engine/reference/run/){:target="_blank"}.

## What is a namespace? ######

A [Linux namespace](http://man7.org/linux/man-pages/man7/namespaces.7.html){:target="_blank"} is an abstraction over resources in the operating system.
We can think of a namespace as a box. Inside this box are these system resources, which ones exactly depend on the box's (namespace's) type.
There are currently 7 types of namespaces `Cgroup`, `IPC`, `Network`, `Mount`, `PID`, `User`, `UTS`.

For instance, the `Network` namespace encapsulates system resources related to networking such
as network interfaces (e.g `wlan0`, `eth0`), route tables etc, the `Mount` namespace encapsulates files and directories in the system, `PID` contains process IDs and so on.
So two instances of a `Network` namespace `A` and `B` (corresponding to two boxes of the same type in our analogy) can contain different resources - maybe `A` contains `wlan0` while `B` contains `eth0` and a different route table copy.

Namespaces aren't some addon feature or library that you need to apt install, they are provided by the Linux kernel itself and already are a prerequisite to run any process on the system.
At any given moment, any process `P` belongs to exactly one instance of each namespace type - so when it needs to say, update the route table on the system, Linux shows it the copy of the route table of the namespace to which it belongs at that moment.

## What is it good for? ######

Absolutely nothi... just kidding. One good thing with boxes is that you can add and remove stuff from one box and it will not affect the content of other boxes.
That's the same idea here with namespaces - a process `P` can go crazy and `sudo rm -rf /` but another process `Q` that belongs to a different `Mount` namespace will be unaffected since they're using distinct copies of those files.

Note though that a resource encapsulated within a namespace doesn't necessarily mean that it's a unique copy.
In a number of cases, either by design or as a security hole, two or more namespaces will contain the same copy, e.g of the same file, so that changes made to that file in one `Mount` namespace will in fact be visible in all other `Mount` namespaces that also references it.
For this reason, we will retire our box analogy here since an item cannot
simultaneously exist in two distinct boxes 😞.

## Unsharing is caring ######

We can see the namespaces that a process belongs to!
In typical Linux fashion, they're exposed as files under the directory `/proc/$pid/ns` for a given process with process id `$pid`:

{% highlight bash %}
$ ls -l /proc/$$/ns
total 0
lrwxrwxrwx 1 iffy iffy 0 May 18 12:53 cgroup -> cgroup:[4026531835]
lrwxrwxrwx 1 iffy iffy 0 May 18 12:53 ipc -> ipc:[4026531839]
lrwxrwxrwx 1 iffy iffy 0 May 18 12:53 mnt -> mnt:[4026531840]
lrwxrwxrwx 1 iffy iffy 0 May 18 12:53 net -> net:[4026531957]
lrwxrwxrwx 1 iffy iffy 0 May 18 12:53 pid -> pid:[4026531836]
lrwxrwxrwx 1 iffy iffy 0 May 18 12:53 user -> user:[4026531837]
lrwxrwxrwx 1 iffy iffy 0 May 18 12:53 uts -> uts:[4026531838]
{% endhighlight %}

You can open a second terminal and run the same command and it should give you the exact same output - this is because, as we mentioned earlier, a process must belong some namespace and unless we explicitly
specify which ones, Linux adds it as a member to the default namespaces.
\\
\\
Let's meddle in this a bit. In the second terminal we can run something like:

{% highlight bash %}
$ hostname
iffy
$ sudo unshare -u bash
$ ls -l /proc/$$/ns
lrwxrwxrwx 1 root root 0 May 18 13:04 cgroup -> cgroup:[4026531835]
lrwxrwxrwx 1 root root 0 May 18 13:04 ipc -> ipc:[4026531839]
lrwxrwxrwx 1 root root 0 May 18 13:04 mnt -> mnt:[4026531840]
lrwxrwxrwx 1 root root 0 May 18 13:04 net -> net:[4026531957]
lrwxrwxrwx 1 root root 0 May 18 13:04 pid -> pid:[4026531836]
lrwxrwxrwx 1 root root 0 May 18 13:04 user -> user:[4026531837]
lrwxrwxrwx 1 root root 0 May 18 13:04 uts -> uts:[4026532474]
$ hostname
iffy
$ hostname coke
$ hostname
coke
{% endhighlight %}

The `unshare` command runs a program (optionally) in a new namespace.
The `-u` flag tells it to run `bash` in a new `UTS` namespace.
Notice how our new `bash` process points to a different `uts` file while all others remain the same.

> Creating new namespaces usually requires superuser access. From now on, we will assume that both `unshare` or our implementation are run with `sudo`.

One implication of what we just did is that we can now change the
system's `hostname` from within our new `bash` process and it won't affect any other process in the system.
You can verify this by running `hostname` in the first shell or a new one
and seeing that the hostname hasn't changed there.

## But like, what is a container though? ######

Hopefully, now you have some idea of what a namespace can do.
You might guess that containers are fundamentally ordinary processes
with different namespaces from other processes and you'd be correct.
In fact a quote, unquote container doesn't have to belong to a unique namespace for each type - it can share some of them.

For instance, when you `docker run --net=host redis`, all you do is tell docker to not create a new `Network` namespace for the `redis` process, and as we saw, Linux will add that process as a member of the default `Network` namespace just like every other regular process.
So the redis process is exactly like everyone else from a networking perspective.
Networking isn't special here,`docker run` let's you do this customization
for most namespaces.
This begs the question of what even is a container?
Is a process that shares all but one namespace still a container? ¯\\\_(ツ)_/¯
\\
Usually containers come with the notion of **isolation**, achieved through namespaces - the smaller the number of namespaces and resources that a process shares, the more isolated the process is and that's all that really matters.

## Isolate ######

In the remainder of this post, we will lay the ground work for our
program that we will call `isolate`.
`isolate` takes a command as arguments and runs that command in a new process isolated from the rest of the system and within it's very own namespaces.
In the coming posts, we will look at adding support for individual
namespaces when `isolate` spins up the command process.

In terms of scope, we will focus on the `User`, `Mount`,
`PID` and `Network` namespaces. The rest are relatively trivial to
implement once we're done (in fact, we add `UTS` support in the initial
implementation here) and `Cgroup` for example is only interesting from a
perspective that is out of scope of this series (studying `cgroups` -
the [other ingredient in containers](http://man7.org/linux/man-pages/man7/cgroups.7.html){:target="_blank"} that is used to control how much of a resource a process is allowed to use).

Namespaces can get complex real quick so there are lots of different
paths we can take while studying each namespace but we can't take them all.
We will only discuss the paths that are relevant to the program that
we're building.
Each post will start off with some experiments on the namespace in
question within a terminal in an attempt to understand the interactions
involved in setting up that namespace.
After this we will already have an idea of what we want to accomplish and will then follow up with a corresponding implementation in `isolate`.

> To avoid bombarding the posts with code, we will not include things like helper functions that are not necessary to understand the implementation. You can find the full source code [here on Github](https://github.com/iffyio/isolate){:target="_blank"}.


## Implementation ######

The source code for this post [can be found here](https://github.com/iffyio/isolate/tree/part-1){:target="_blank"}.
Our `isolate` implementation will initially be a simple program that reads
a command path from stdin and clones a new process that executes the command with the specified arguments.
The cloned command process will run in it's own `UTS` namespace
just like we did with `unshare` earlier.
In later posts, we will see that namespaces do not necessarily work (or even provide isolation) out of the box and we will need to do some setup after creating them (but before executing the actual command) in order for the command to truly run in isolation.

This namespace creation-setup combo will require some co-operation between
the main `isolate` process and the child command process.
As a result, part of the ground work here will be to setup a
communication channel between both processes - we will use a [Linux pipe](https://www.tldp.org/LDP/lpg/node11.html){:target="_blank"}
due to its simplicity given our use case.

\\
We have three things to do:

1. Create the main `isolate` process that reads from stdin.
2. Clone a new process that will run the command in a new `UTS` namespace.
3. Set up a pipe so that the command process begins the command
execution only after it receives a signal from the main process
that the namespace setup is done.

Here is the main process:

{% highlight C %}
int main(int argc, char **argv)
{

    struct params params;
    memset(&params, 0, sizeof(struct params));
    parse_args(argc, argv, &params);

    // Create pipe to communicate between main and command process.
    if (pipe(params.fd) < 0)
        die("Failed to create pipe: %m");

    // Clone command process.
    int clone_flags = SIGCHLD | CLONE_NEWUTS ;
    int cmd_pid = clone(cmd_exec, cmd_stack + STACKSIZE, clone_flags, &params);

    if (cmd_pid < 0)
        die("Failed to clone: %m\n");

    // Get the writable end of the pipe.
    int pipe = params.fd[1];

    // Some namespace setup will take place here ...

    // Signal to the command process we're done with setup.
    if (write(pipe, "OK", 2) != 2)
        die("Failed to write to pipe: %m");
    if (close(pipe))
        die("Failed to close pipe: %m");

    if (waitpid(cmd_pid, NULL, 0) == -1)
        die("Failed to wait pid %d: %m\n", cmd_pid);

    return 0;
}
{% endhighlight %}

Check out `clone_flags` that we pass to our `clone` invocation,
See how dead simple it is to create a new process in it's own namespace?
All we have to do is set the flag for the namespace type
(the `CLONE_NEWUTS` flag corresponds to the `UTS` namespace) and Linux
takes care of the rest.
\\
\\
Next, the command process waits for a signal before exec-ing the command:

{% highlight C %}
static int cmd_exec(void *arg)
{
    // Kill the cmd process if the isolate process dies.
    if (prctl(PR_SET_PDEATHSIG, SIGKILL))
        die("cannot PR_SET_PDEATHSIG for child process: %m\n");

    struct params *params = (struct params*) arg;
    // Wait for 'setup done' signal from the main process.
    await_setup(params->fd[0]);

    char **argv = params->argv;
    char *cmd = argv[0];
    printf("===========%s============\n", cmd);

    if (execvp(cmd, argv) == -1)
        die("Failed to exec %s: %m\n", cmd);

    die("¯\\_(ツ)_/¯");
    return 1;
}
{% endhighlight %}

Finally we can try it out:

{% highlight bash %}
$ ./isolate sh
===========sh============
$ ls
isolate  isolate.c  isolate.o  Makefile
$ hostname
iffy
$ hostname coke
$ hostname
coke
# Verify in a new terminal that hostname hasn't been updated
{% endhighlight %}

Currently, `isolate` is a little bit more than a program that
just forks off a command (we do have the `UTS` thing going for us).
In the next post, we take it a step further by looking at `User`
namespaces and have `isolate` run the command in it's own `User` namespace.
There, we will see that we actually need to do some work in order to
have a usable namespace in which the command can run.
