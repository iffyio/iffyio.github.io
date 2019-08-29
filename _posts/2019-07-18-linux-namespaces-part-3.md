---
layout: post
title: "A deep dive into Linux namespaces, part 3"
categories: posts
excerpt: "Running processes in isolated mount and pid namespaces"
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


[Mount namespaces](http://man7.org/linux/man-pages/man7/mount_namespaces.7.html){:target="_blank"} isolate filesystem resources.
This pretty much covers everything that has to do with files on the system.
Among the encapsulated resources is a file containing the list of [mount points](http://www.linfo.org/mount_point.html){:target="_blank"} that are visible to a process and as we hinted at in the [intro post]({{ site.baseurl }}{% post_url 2019-06-27-linux-namespaces-part-1 %}), isolation can enforce that changing the list (or any other file) within some mount namespace instance `M` does not affect that list in a different instance (so that only the processes in `M` observe the changes).


## Mount Points ######

You might be wondering why we just zoomed in on a seemingly random file that contains a list - what's so special about it?
The list of mount points determines a process' entire view of available [filesystems](https://www.tldp.org/LDP/sag/html/filesystems.html){:target="_blank"} on the system and since we're in Linux land with the *everything is a file* mantra, the visibility of pretty much every resource is dictated by this view - from actual files and devices to information about which other processes are also running in the system.
So it's a huge security win for `isolate` to be able to dictate exactly what parts of the system we want commands that we run to be aware of. Mount namespaces combined with mount points are a very powerful tool that lets us acheive this.
\\
\\
We can see mount points visible to a process with id `$pid` via the `/proc/$pid/mounts` file - its contents is the same for all processes that belong to the same mount namespace as `$pid`:

{% highlight bash %}
$ cat /proc/$$/mounts
...
/dev/sda1 / ext4 rw,relatime,errors=remount-ro,data=ordered 0 0
...
{% endhighlight %}

Spotted somewhere in the list returned on my system is the `/dev/sda1` device mounted at `/` (yours might differ). This is the disk device hosting the [root filesystem](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/ch03.html){:target="_blank"} that contains all the good stuff needed for the system to start and run properly so it would be great if `isolate` runs commands without them knowing about filesystems like these.
\\
\\
Let's start by running a terminal in its own mount namespace:

> Strictly speaking, we don't need superuser access to work with new mount namespaces as long as we include the user namespace setup procedures of the previous post. As a result, in this post we will only assume that `unshare` commands within the terminal are running as superuser. `isolate` doesn't need this assumption.


{% highlight bash %}
# The -m flag creates a new mount namespace.
$ unshare -m bash
$ cat /proc/$$/mounts
...
/dev/sda1 / ext4 rw,relatime,errors=remount-ro,data=ordered 0 0
...
{% endhighlight %}


Hmmm, we can still see the same list as in the root mount namespace.
Especially after witnessing in the [previous post]({{ site.baseurl }}{% post_url 2019-07-10-linux-namespaces-part-2 %}) that a new user namespace begins with a clean slate, it may seem that the `-m` flag we passed to `unshare` didn't have any effect.

The shell process is in fact running in a different mount namespace (we can verify this by comparing the symlinked file `ls -l /proc/$$/ns/mnt` to that of another shell running in the root mount namespace).
The reason we still see the same list is that whenever we create a new mount namespace (child), a copy of the mount points of the mount namespace where the creation took place (parent) is used as the child's list.
Now any changes we make to this file (e.g by mounting a  filesystem) will be invisible to all other processes.

However, changing pretty much any other file at this point *will* affect other processes because we are still referencing the exact same files (Linux only makes copies of special files like the mount points list).
This means that we currently have minimal isolation. If we want to limit what our command process will see, we must update this list ourselves.
\\
\\
Now, on one extreme, since we're trying to be security conscious, we could just say F\* it and have `isolate` clear the entire list before executing the command but that will render the command useless since every program at least has dependencies on resources like operating system files, which in turn, are backed by *some* filesystem.
On the other extreme, we could also just execute the command as is, sharing with it, the same filesystems that contain the necessary system files that it requires but this obviously defeats the purpose of this isolation thing that we have going on.
\\
\\
The sweet spot would provide the program with its very own copy of dependencies and system files that it requires to run, all sandboxed so that it can make any changes to them without affecting other programs on the system.
In the best case scenario, we would wrap these files in a filesystem and mount it as the root filesystem (at the root directory `/`) before executing the un-suspecting program.
The idea is, because everything reachable by a process must go via the root filesystem and because we will know exactly what files we put in there for the command process, we will rest easy knowing that it is properly isolated from the rest of the system.
\\
\\
Alright, this sounds good in theory and in order to pull it off, we will do the following:

1. Create a copy of the dependencies and system files needed by the command.
2. Create a new mount namespace.
3. Replace the root filesystem in the new mount namespace with one that is made up of our system files copy.
4. Execute the program inside the new mount namespace.

## Root Filesystems ######

A question that arises already at step `1` is *which system files are even needed by the command we want to run?* We could rummage in our own root filesystem and ask this question for every file that we encounter and only include the ones where the answer is *yes* but that sounds painful and unnecessary. Also, we don't even know what command `isolate` will be executing to begin with.
\\
\\
If only people have had this same issue and gathered a set of system files, generic enough to serve as a base right out of the box for a majority of programs out there?
Luckily there are many projects that do this! One of which is the [Alpine Linux project](https://alpinelinux.org/){:target="_blank"} (this is its main function when you start `FROM alpine:xxx` in your `Dockerfile`).
Alpine provides [root filesystems](https://alpinelinux.org/downloads/){:target="_blank"} that we can use for our purposes. If you are following along, you can get a copy of their minimal root filesystem (`MINI ROOT FILESYSTEM`) for `x86_64` [here](http://dl-cdn.alpinelinux.org/alpine/v3.10/releases/x86_64/alpine-minirootfs-3.10.1-x86_64.tar.gz){:target="_blank"}. The latest version at the time of writing and that we will use in this post is `v3.10.1`.

{% highlight bash %}
$ wget http://dl-cdn.alpinelinux.org/alpine/v3.10/releases/x86_64/alpine-minirootfs-3.10.1-x86_64.tar.gz
$ mkdir rootfs
$ tar -xzf alpine-minirootfs-3.10.1-x86_64.tar.gz -C rootfs
$ ls rootfs
bin  dev  etc  home  lib  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var
{% endhighlight %}


The `rootfs` directory has familiar files just like our own root filesystem at `/` but checkout how minimal it is - quite a few of these directories are empty:

{% highlight bash %}
$ ls rootfs/{mnt,dev,proc,home,sys}
# empty
{% endhighlight %}

This is great! we can give the command that we launch a copy of this and it could `sudo rm -rf /` for all we care, no one else will be bothered.

## Pivot root ######

Given our new mount namespace and a copy of system files, we would like to mount those files on the root directory of the new mount namespace without pulling the rug from under our feet.
Linux has us covered here with the `pivot_root` system call (there is an associated command) that allows us to control what a processes sees as the root filesystem.

The command takes two arguments `pivot_root new_root put_old` where `new_root` is the path to the filesystem containing the soon-to-be root filesystem and `put_old` is a path to a directory. It works by:

1. Mounting the root filesystem of the calling process on `put_old`.
2. Mounting the filesystem pointed to by `new_root` as the current root filesystem at `/`.

Let's see this in action. In our new mount namespace, we start by creating a filesystem out of our alpine files:

{% highlight bash %}
$ unshare -m bash
$ mount --bind rootfs rootfs
{% endhighlight %}

Next we pivot root:

{% highlight bash %}
$ cd rootfs
$ mkdir put_old
$ pivot_root . put_old
$ cd /
# We should now have our new root. e.g if we:
$ ls proc
# proc is empty
# And the old root is now in put_old
$ ls put_old
bin   dev  home        lib    lost+found  mnt  proc  run   srv  tmp  var
boot  etc  initrd.img  lib64  media       opt  root  sbin  sys  usr  vmlinuz
{% endhighlight %}

Finally, we unmount the old filesystem from `put_old` so that the nested shell cannot access it.

{% highlight bash %}
$ umount -l put_old
{% endhighlight %}

With that, we can run any command in our shell and they will run using our custom alpine root filesystem, unaware of the orchestration that led up to their execution.
And our precious files on the old filesystem are safe beyond their reach.


## Implementation ######

> The source code for this post [can be found here](https://github.com/iffyio/isolate/tree/part-3){:target="_blank"}.


We can replicate what we just accomplished in code, swapping the `pivot_root` command for the corresponding system call.
First, we create our command process in a new mount namespace by adding the `CLONE_NEWNS` flag to `clone`.


{% highlight C %}
int clone_flags = SIGCHLD | CLONE_NEWUTS | CLONE_NEWUSER | CLONE_NEWNS;
{% endhighlight %}


Next, we create a function `prepare_mntns` that, given a path to a directory containing system files (`rootfs`), sets up the current mount namespace by pivoting the root of the current process to `rootfs` as we did earlier.

{% highlight C %}
static void prepare_mntns(char *rootfs)
{
    const char *mnt = rootfs;

    if (mount(rootfs, mnt, "ext4", MS_BIND, ""))
        die("Failed to mount %s at %s: %m\n", rootfs, mnt);

    if (chdir(mnt))
        die("Failed to chdir to rootfs mounted at %s: %m\n", mnt);

    const char *put_old = ".put_old";
    if (mkdir(put_old, 0777) && errno != EEXIST)
        die("Failed to mkdir put_old %s: %m\n", put_old);

    if (syscall(SYS_pivot_root, ".", put_old))
        die("Failed to pivot_root from %s to %s: %m\n", rootfs, put_old);

    if (chdir("/"))
        die("Failed to chdir to new root: %m\n");

    if (umount2(put_old, MNT_DETACH))
        die("Failed to umount put_old %s: %m\n", put_old);
}
{% endhighlight %}

We need to call this function from our code and it must be done by our command process in `cmd_exec` (since its the one running within the new mount namespace), before the actual command begins execution.

{% highlight C %}
    ...
    // Wait for 'setup done' signal from the main process.
    await_setup(params->fd[0]);

    prepare_mntns("rootfs");
    ...
{% endhighlight %}

Let's try it out:

{% highlight bash %}
$ ./isolate sh
===========sh============
$ ls put_old
# put_old is empty. Hurray!
# What does our new mount list look like?
$ cat /proc/$$/mounts
cat: cant open '/proc/1431/mounts': No such file or directory
# Hmmm, what other processes are running?
$ ps aux
PID   USER     TIME  COMMAND
# Empty! eh?
{% endhighlight %}

This output shows something strange - we're unable to verify the mount list that we have fought so hard for, and `ps` tells us that there are no processes running on the system (not even the current process or `ps` itself?).
Its more likely that we broke something while setting up the mount namespace.

## PID Namespaces ######

We've mentioned the `/proc` directory a few times so far in this series and if you were familiar with it, then you're probably not surprised that `ps` came up empty since we saw earlier that the directory was empty within this mount namespace (when we got it from the alpine root filesystem).
\\
\\
The `/proc` directory in Linux is usually used to expose a [special filesystem](https://www.tldp.org/LDP/Linux-Filesystem-Hierarchy/html/proc.html){:target="_blank"} (called the proc filesystem) that is managed by Linux itself.
Linux uses it to expose information about all processes running in the system as well as other system information with regards to devices, interrupts etc.
Whenever we run a command like `ps` which accesses information about processes in the system, it looks to this filesystem to fetch information.

In other words, we need to spin up a `proc` filesystem.
Luckily, this basically involves telling Linux that we need one, preferably mounted at `/proc`. But we can't do so just yet since our command process is still dependent on the same `proc` filesystem as `isolate` and every other regular process in the system - to cut this dependency, we need to run it inside its own `PID` namespace.
\\
\\
The [PID namespace](http://man7.org/linux/man-pages/man7/pid_namespaces.7.html){:target="_blank"} isolates process IDs in the system. One effect is that processes running in different PID namespaces can have the same process ID without conflicting with each other.
Granted that we're isolating this namespace because we want to give as much isolation as we can to our running command, a more interesting reason we show it here is that mounting the `proc` filesystem requires root privileges and the current PID namespace is owned by the root user namespace where we do not have sufficient permissions (if you remember from the [previous post]({{ site.baseurl }}{% post_url 2019-07-10-linux-namespaces-part-2 %}), `root` to the command process isn't really root).
So, we must be running within a PID namespace owned by the user namespace that recognizes our command process as root.
\\
\\
We can create a new PID namespace by passing the `CLONE_NEWPID` to `clone`:

{% highlight C %}
int clone_flags = SIGCHLD | CLONE_NEWUTS | CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWPID;
{% endhighlight %}

Next, we add a function `prepare_procfs` that sets up the proc filesystem by mounting one within the currently mount and pid namespace.

{% highlight C %}
static void prepare_procfs()
{
    if (mkdir("/proc", 0555) && errno != EEXIST)
        die("Failed to mkdir /proc: %m\n");

    if (mount("proc", "/proc", "proc", 0, ""))
        die("Failed to mount proc: %m\n");
}
{% endhighlight %}

Finally, we call the function right before unmounting `put_old` in our `prepare_mntns` function, after we have setup the mount namespace and changed to the root directory.

{% highlight C %}
static void prepare_mntns(char *rootfs)
{
  ...

    prepare_procfs();

    if (umount2(put_old, MNT_DETACH))
        die("Failed to umount put_old %s: %m\n", put_old);
  ...
}
{% endhighlight %}

We can take `isolate` for another spin:

{% highlight C %}
$ ./isolate sh
===========sh============
$ ps
PID   USER     TIME  COMMAND
    1 root      0:00 sh
    2 root      0:00 ps
{% endhighlight %}

This looks much better! The shell sees itself as the only process running on the system and running as PID 1 (since it was the first process to start in this new PID namespace).
\\
\\
This post covered two namespaces and `isolate` racked up two new features as a result. In the [next post]({{ site.baseurl }}{% post_url 2019-08-29-linux-namespaces-part-4 %}), we will be looking at isolation via `Network` namespaces. There, we will have to deal with some intricate, low-level network configuration in an attempt to enable network communication between processes in different network namespaces.