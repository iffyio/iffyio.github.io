---
layout: post
title: "A deep dive into Linux namespaces, part 2"
categories: posts
excerpt: "Running processes with isolated user namespaces"
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

In the [previous post]({{ site.baseurl }}{% post_url 2019-06-27-linux-namespaces-part-1 %}){:target="_blank"} we dipped our toes into namespace waters and in the process, saw how simple it was to to get a process up and running with an isolated `UTS` namespace.
In this post, we shine a spotlight on the `User` namespace.


[User namespaces](http://man7.org/linux/man-pages/man7/user_namespaces.7.html) isolate, among other security related resources, user and group identities in the system.
We will focus solely on the user and group ID (`UID` and `GID` respectively) resources in this post as they are fundamental role to carrying out permissions checks and other security related activities throughout the system.

On Linux, these IDs are simply integers that identify users and groups in the system and every process is assigned a few of them in order to determine what operations/resources that process can and cannot access - 
the process' ability to cause damage is dependent on the permissions associated with its assigned IDs

## User Namespaces ######

> We will illustrate the capabilities of user namespaces using only user IDs. The exact same interactions apply to group IDs, which will be visited later on in the post.

A user namespace has its own copy of user and group identifiers.
Isolation then enables a process to be associated with a different set of IDs depending on the user namespace to which it belongs at any given moment. For example, a process `$pid` might be running as `root` (UID `0`) in a user namespace `P` and suddenly continues running as `proxy` (UID `13`) after it switched to a different user namespace `Q`.


User namespaces can be nested! This means that a user namespace instance (parent) can have zero or more child namespaces and each child namespace can, in turn, have its own child namespaces and so on...(until a limit of 32 nested levels).
When a new user namespace `C` is created, Linux sets the current user namespace `P` of the process that creates `C` to be `C`'s parent and this cannot be changed afterwards.
The effect is that all user namespaces have exactly one parent,  forming a tree structure of namespaces.
And as with trees, the exception to this is at the top where we have the *root* (or *initial* or *default*) namespace - unless you're already doing some container magic, this is most likely the user namespace to which all your processes belong as it is the single user namespace when the system starts.

> In this post, we will use the command prompts `P$` and `C$` to denote a shell that is currently running within the parent `P` and child `C` user namespace respectively.

## User ID Mappings ######

A user namespace essentially contains a set of IDs and some information linking those IDs to the set of IDs of other user namespaces - this duo determines a process' entire view of IDs available in the system.
Let's see what this might look like:

{% highlight bash %}
P$ whoami
iffy
P$ id
uid=1000(iffy) gid=1000(iffy)
{% endhighlight %}

In another terminal window let's run a shell using `unshare` (the `-U` flag creates the process in a new user namespace):

{% highlight bash %}
P$ whoami
iffy
P$ unshare -U bash
# Enter a new shell that runs within a nested user namespace
C$ whoami
nobody
C$ id
uid=65534(nobody) gid=65534(nogroup) 
C$ ls -l my_file
-rw-r--r-- 1 nobody nogroup 0 May 18 16:00 my_file
{% endhighlight %}

Wait, who? Now that we're in a nested shell in `C` the current user becomes `nobody`?
We might have guessed that because `C` is a new user namespace, the process could have a different view of IDs so we might not have expected it to remain `iffy`, but `nobody` is no fun 😒.
On the bright side, this is great because we got the isolation that we asked for. Our process now has a different (albeit broken) view of IDs in the system - currently it sees everybody as `nobody` and every group as `nogroup`.
\\
\\
The information linking UIDs from one namespace to another is called a **user ID mapping**.
It represents lookup tables from IDs in the current user namespace to IDs in other user namespaces and every user namespace is associated with exactly one UID mapping (in addition to one GID mapping for group IDs).

This mapping is what's broken within our `unshare` shell.
It turns out that new user namespaces start out with an empty mapping and as a result, Linux defaults to the dreaded `nobody` user.
We need to fix this before we can do any useful work inside our new namespace. For instance, currently, system calls (e.g `setuid`) that try to work with UIDs will fail.
But fear not! inline with the *all-of-the-things-as-a-file* tradition, Linux exposes this mapping via the `/proc` filesystem at `/proc/$pid/uid_map` (`/proc/$pid/gid_map` for GID) where `$pid` is a process ID. We will refer to these two files as *map files*.


## Map files ######

Map files are special files on the system. Special how? well, the kind that returns different contents whenever you read from it, depending on what process you're reading from.
For instance, the map file `/proc/$pid/uid_map` returns a mapping from UIDs in the user namespace to which the process `$pid` belongs, to UIDs in the user namespace of the reading process and as a result, the content returned to process `X` may differ from what is returned to process `Y` even though they read the same map file at the same time.
\\
\\
Specifically, a process `X` that reads a UID map file `/proc/$pid/uid_map` receives a set of rows. Each row maps a range of contiguous UIDs in process `$pids`'s user namespace `C` to a corresponding UID range in the other namespace.

Each row has the format `$fromID $toID $length` where:

* `$fromID` is the start UID of the range for the user namespace of process `$pid`
* `$length` is the length of the range.
* Translating `$toID` is dependent on the reading process `X`. If `X` belongs to a different user namespace `U`, then `$toID` is the start UID of the range in `U` to which `$fromID` maps. Otherwise, `$toID` is the start UID of the range in `P`, the parent user namespace of `C`.

For example, if a process reads the file `/proc/1409/uid_map` and among the received rows is `15 22 5`, then UIDs 15 through 19 in process `1409`'s user namespace maps to UIDs 22-26 in the reading process' distinct user namespace.

On the other hand, if a process reads from the file `/proc/$$/uid_map` (or the map file for any process that belongs to the same user namespace as it does) and receives `15 22 5`, then UIDs 15 through 19 in its user namespace `C` maps to UIDs 22 through 26 in `C`'s parent user namespace.

Let's try this out:

{% highlight bash %}
P$ echo $$
1442
# In a new user namespace...
C$ echo $$
1409
# C has no mappings to it's parent since it is new
C$ cat /proc/1409/uid_map
# Empty
# While root namespace P has dummy mappings for all
# UIDs to the same UID in its non-existent parent
P$ cat /proc/1442/uid_map
         0          0 4294967295
# UIDs 0 through 4294967294 in P is mapped
# to 4294967295 - the special no user ID - in C.
C$ cat /proc/1409/uid_map
         0 4294967295 4294967295
{% endhighlight %}

Okay, that wasn't very exciting since these were two extreme cases but it does tell us a few things:

1. A newly created user namespace will in fact have empty map files.
2. The UID 4294967295 is unmapped and unusable, even in the `root` namespace. Linux treats this UID specially to represent that there is **no user ID**.

## Writing UID Map files ######

To fix our newly created user namespace `C`, we simply need to provide our desired mappings by writing them to the map file for any process that belongs to `C` (we cannot update this file after writing to it). Writing to this file tells Linux two things:

1. What UIDs are available to processes that belong to that target user namespace `C`.
2. What UIDs in the current user namespace correspond to the UIDs in `C`.

For instance, if we, from the parent user namespace `P`, write the following to the user map file for child namespace `C`:

```
0 1000 1
3    0 1
```

we essentially tell Linux that:

1. As far as processes in `C` are concerned, the only UIDs that exist in the system are UIDs `0` and `3` - e.g a system call to `setuid(9)` will always fail with something like *invalid user id*.
2. UIDs `1000` and `0` in `P` correspond to UIDs `0` and `3` in `C` - e.g if a process, running as UID `1000` in `P`, switches to `C`, it will observe its UID has become `root` `0` after the switch.




## Owner Namespaces And Privileges ######

In the [previous post]({{ site.baseurl }}{% post_url 2019-06-27-linux-namespaces-part-1 %}){:target="_blank"} we mentioned that superuser access was required when creating new namespaces.
User namespaces do not have this requirement. In fact, they are also special in that they can *own* other namespaces. 

Whenever a non-user namespace `N` is created, Linux designates the current user namespace `P` of the process creating `N`, the *owner* of namespace `N`.
If `P` is created alongside other namespaces in the same `clone` system call, Linux guarantees that `P` will be created first and designated the owner of the other namespaces.
\\
\\
Owner namespaces are important because a process requesting to carry out a privileged action on a resource encapsulated by a non-user namespace will have its UID privileges checked against the owner user namespace and not the root user namespace.
For example, say `P` is the parent user namespace of child `C` and `P` and `C` own network namespaces `M` and `N` respectively, a process might not have privilege to create network devices encapsulated by `M` but might be able to do so for `N`.
\\
\\
The implication of owner namespaces for us is that we can drop the `sudo` requirement when running commands with `unshare` or `isolate` as long as we request a user namespace to be created as well - e.g. `unshare -u bash` will require `sudo` but `unshare -Uu bash` will not:

{% highlight bash %}
# UID 1000 is a non-privileged user in the root user namespace P.
P$ id
uid=1000(iffy) gid=1000(iffy)
# And as a result cannot create a network device in the root
# network namespace.
P$ ip link add type veth
RTNETLINK answers: Operation not permitted
# Let's try our luck again, this time from a
# different user and network namespace
P$ unshare -nU bash # NOTE: no sudo
C$ ip link add type veth
RTNETLINK answers: Operation not permitted
# Hmm still no dice. This makes sense since only
# UID 0 (root) is allowed to create network devices and
# currently we're nobody. Let's fix that.
C$ echo $$
13294
# Back in P, we map UID 1000 in P to UID 0 in C
P$ echo "0 1000 1" > /proc/13294/uid_map
# Who are we now?
C$ id
uid=0(root) gid=65534(nogroup)
C$ ip link add type veth
# Success!
{% endhighlight %}


> Unfortunately, we will re-enforce the superuser requirement in the next post since `isolate` needs root privileges in the root namespace in order to set up the `Mount` and `Network` namespaces properly. But we will make sure to drop the privileges before executing the command process to ensure that the command doesn't have unecessary permissions.

## How IDs are resolved ######

We just saw a process running as a regular user `1000` suddenly switch to `root` 😮. Don't worry, there wasn't any privilege escalation involved.
Remember that this is just a *mapping* of IDs - while our process *thinks* it is `root` on the system, Linux knows that `root` in its case means the regular UID `1000` (thanks to our mapping) so while namespaces owned by its new user namespace (like the network namespace in `C`) respects its authoritah as `root`, others (like the network namespace in `P`) do not so the process cannot do anything that user `1000` could not.
\\
\\
Whenever a process in a nested user namespace carries out an operation that requires a permission check, e.g creating a file, it's UID in that namespace is looked up against the equivalent user ID in the `root` user namespace by traversing mappings in the namespace tree up to the root.
The opposite direction is traversed when it e.g reads user IDs like we would with `ls -l my_file` - the UID of `my_file`'s owner is mapped from the `root` user namespace down to the current namespace and the final mapped ID  (or `nobody` if a mapping was missing somewhere along the tree) is presented to the reading process.


## Group IDs ######

Even though we have ended up as `root` in `C` we're still associated with the dreaded `nogroup` as our group ID. We simply need to do the same for the corresponding `/proc/$pid/gid_map`.
Before we can do that, we need to disable the `setgroups` system call (this shouldn't be neccessary if your user already has the `CAP_SETGID` capability in `P` but we won't assume this since this usually comes with superuser privileges) by writing "deny" to the `proc/$pid/setgroups` file:

{% highlight bash %}
# Where 13294 is the pid for the unshared process
C$ id
uid=0(root) gid=65534(nogroup)
P$ echo deny > /proc/13294/setgroups
P$ echo "0 1000 1" > /proc/13294/gid_map
# Our group ID mapping is reflected
C$ id
uid=0(root) gid=0(root)
{% endhighlight %}

## Implementation ######

> The source code for this post [can be found here](https://github.com/iffyio/isolate/tree/part-2){:target="_blank"}.

As you can see, there are a lot of intricacies involved in managing user namespaces but implementation is quite straightforward. All we need to do is write a bunch of rows to a file - the chore was in knowing what and where to write. Without further ado, here are our goals to accomplish:

1. Clone the command process in its own user namespace.
2. Write to the UID and GID map files of the command process.
3. Drop any superuser privileges before executing the command.

`1` is accomplished by simply adding the `CLONE_NEWUSER` flag to our `clone` system call.

{% highlight C %}
int clone_flags = SIGCHLD | CLONE_NEWUTS | CLONE_NEWUSER;
{% endhighlight %}

For `2`, we add a function `prepare_user_ns` that conservatively exposes a single regular user `1000` as `root`.

{% highlight C %}
static void prepare_userns(int pid)
{
    char path[100];
    char line[100];

    int uid = 1000;

    sprintf(path, "/proc/%d/uid_map", pid);
    sprintf(line, "0 %d 1\n", uid);
    write_file(path, line);

    sprintf(path, "/proc/%d/setgroups", pid);
    sprintf(line, "deny");
    write_file(path, line);

    sprintf(path, "/proc/%d/gid_map", pid);
    sprintf(line, "0 %d 1\n", uid);
    write_file(path, line);
}
{% endhighlight %}

And call it from within the main process in the parent user namespace, right before we signal to the command process.

{% highlight C %}
    ...
    // Get the writable end of the pipe.
    int pipe = params.fd[1];

    // Some namespace setup will take place here ...
    prepare_userns(cmd_pid);

    // Signal to the command process we're done with setup.
    ...
{% endhighlight %}

For step `3` we update the `cmd_exec` function to ensure that the command runs as the regular, unprivileged user `1000` we provided in the mapping (remember the root user `0` within the command process' user namespace is user `1000`):

{% highlight C %}
    ...
    // Wait for 'setup done' signal from the main process.
    await_setup(params->fd[0]);

    if (setgid(0) == -1)
      die("Failed to setgid: %m\n");
    if (setuid(0) == -1)
      die("Failed to setuid: %m\n");
    ...
{% endhighlight %}


And that's it! `isolate` now runs a process in an isolated user namespace.

{% highlight C %}
$ ./isolate sh
===========sh============
$ id
uid=0(root) gid=0(root)
{% endhighlight %}

This post went into quite a lot of detail about how `User` namespaces work but in the end, setting up an instance was relatively painless. In the next post, we will be looking at having `isolate` run the command in its own `Mount` namespace (uncovering the mystery behind the `Dockerfile` `FROM` [instruction](https://docs.docker.com/engine/reference/builder/#from){:target="_blank"}). There, we will be required to give Linux a bit more help in order to set up an instance properly.