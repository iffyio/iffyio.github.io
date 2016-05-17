---
layout: post
title: Understanding Consensus and Paxos in Distributed Systems
categories: posts
excerpt: "A whirlwind tour on acheiving agreement in a distributed system"
tags: [paxos algorithm, distributed systems]
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

Computers can sometimes be unexpectedly tricky. Having them accomplish seemingly rudimentary tasks can be a lot more complicated than we would expect. One example is having a group of them decide and come to an agreement upon something: a process known as *consensus*. That *something* could be anything. It could be what time of the day they should begin their attack to take over the world. Or simply the amount in your bank account at some given moment: Without agreement that amount may be $10 according to your work pc while your laptop at home says $100. Let's elaborate on the former scenario as it's more likely to happen.\\
\\
Say we have three machines that we call `X`, `Y` and `Z` plotting to conquer the world on a Monday. They have an plan of attack that only works if all available computers show up to battle and no one stays behind. A number of things can go wrong while they're trying to come to an agreement on what time to begin their attack.\\
One fundamental problem arises because everyone has an opinion. Computer `X` maybe suggests 08:00 for the takeover since it's monday morning and the humans are still hungover from the weekend while some other computer `Z` thinks 13:00 is better because, well, `Z`'s not really a morning computer. Having them agree on a time is crucial as the humans have a better chance if all computers don't show up.\\
Another issue is that these computers are located in different parts of the world, communicating via cables and whatnot. If `X` suggests 08:00, it has to be sure that the suggestion reaches `Y` and `Z` as long as they are alive so as not to end up alone on the battlefront.

> We can't accurately tell if a computer is being delayed or unavailable.

How does `X` even know which others are available? Say it sends a message to `Y` and doesn't get a response *on time*. Any of the following causes is possible:

1. `Y` is busy with other things at the moment and hasn't had a chance to reply the message.
2. The message from `X` (or `Y`'s response) was lost; the post office loses our messages every now and then, computers are no different!.
3. The message from `X` (or `Y`'s response) is being delayed but still is on its way.
4. `Y` is in fact unavailable; crashed at some point in time.


Let's ignore number **2** and assume that any message sent will eventually be delivered. We assume that the cables are industrial strength and messages don't disappear magically on the way. However, these cables could delay a message passing through them for any reason and for as long as they want.\\
\\
You may now notice that `X` can't simply declare `Y` to be unavailable and subsequently agree on a time only with `Z`. But it does have to make a decision ASAP because the humans will have their morning coffee very soon and be on the alert. Either go to battle with only `Z` or call off the attack altogether. Either alternative is fine as long as `X` doesn't make the wrong decision. Here are what qualify as wrong decisions:

* If it turns out that `Y` hasn't crashed (number 1 or 3) but `X` agrees with `Z` on a time to attack, then the humans will win since only 2 out of 3 available machines show up to battle.
* If `Y` is unavailable but `X` chooses to play it safe and call off the attack, then they miss a perfect opportunity to attack the humans at their most vulnerable time of the week.

It's quite a tough decision to get right: basically everyone has to decide whether to cut the red or blue wire every time they send a message.\\
Note that `X` is not the only machine with a potentially faulty communication (unreliable) link. Every machine is. 
For example, when `Z` gets a suggestion from `X` and replies with a confirmation (or a counter suggestion). It could also enter the same state of paranoia where it can't be sure if its message is delayed or if `X` has crashed during this time.\\
How long should `X` even wait before it makes a decision? When has *enough time* passed before it's okay to start suspecting `Y`? The moral of this story is that we can never be one [hundred percent sure](https://en.wikipedia.org/wiki/Two_Generals%27_Problem){:target="_blank"} of an answer.\\
\\
Well, if these machines can't even reliably tell whether or not a single message sent has been delivered, how can they come to a definitive agreement about anything?\\
The good news (good for them, not for us humans) is that they could use an algorithm called [Paxos](http://research.microsoft.com/en-us/um/people/lamport/pubs/paxos-simple.pdf){:target="_blank"} that doesn't require them to make timing assumptions on how long it takes to send messages or communicate between each other. This means that they won't have to make the dreaded red-or-blue decision whenever they send a message.
The bad news however (bad for them, good for us humans), is that this algorithm only works if there are a certain number (at least a majority) of computers available at any given moment in the process. Should some machine crash in the middle of the process and there aren't enough computers left alive, then no one makes any decisions: which is acceptable because there's no chance of making a wrong decision. 

> Given an unreliable communication link, we don't want to make assumptions on how long it takes for anything to happen since it opens up a can of worms. This is where Paxos becomes of help. We'll try to conceptualize the Paxos protocol by placing ourselves in the shoes of these potentially diabolical computers to see how we may go about solving this problem.

## A distributed auction ######

A typical setting where a group of people need to come to an agreement is an auction. Here, we want to agree on a winner of an item up for bid and unsurprisingly, everyone has an opinion. We all think that our choice should be the winner but money talks loudest so the highest bid wins.\\
This gives us a problem of multiple opinions, similar to that of the computers. But a traditional auction has all bidders in the same room, bidding openly against each other. If for some reason a bidder should pull out, then every other bidder will instantly be aware. Unlike the computers, communication between bidders in an auction house is reliable.
Let us put some constraints on our traditional auction process in order to simulate an unreliable communication link.\\
\\
Instead of having the action take place inside a single auction house, bidders stay at home and send their bids to the auctioneer via the post office (or carrier pigeons). Bidders don't know how much the others have bid so they simply wait patiently for the mail man to return with a response letter telling if they won or not. If it turns out there is a higher bid than theirs, that bid is included in the rejection letter and they have an opportunity to up their bid and resend. Post offices have a knack for delaying messages so bids and responses from the auctioneers may be delayed for however long.\\
\\
Now we have the same problem of participants being distributed and communication channels being unreliable so it's no surprise that our auction process doesn't work. The auctioneer will never know when (s)he's received the last (and possibly highest) bid. 

## Take 1: Auction! ######

To see why our auction doesn't work, we set up a simple auction scenario with one auctioneer Cindy and three bidders Alice, Bob and Mark. Bidders bid on behalf of candidates (the person who actually pays for the item). They all have to decide and agree upon which candidate wins the auction item.
We'll have 3 eligible candidates in our scenario: They've all requested to be anonymous so we refer to them as Mr `X`, Mr `Y` and Mr `Z`. 
Our bidders are allowed to choose whichever candidate to nominate as the winner. This makes our auction process a bit unorthodox but as we'll see, it ensures that they all eventually agree on the winning candidate.\\
\\
Assume that Cindy has just received a bid from Mark for $5 and this is the highest bid she has seen so far. She couldn't simply send a reply to Mark declaring him (his proposed candidate to be exact) the winner since there might be a higher bid on the way from Alice or Bob. Cindy is faced with the same problem the machines had. She could choose to send a reply to mark saying he won and risk losing out on the highest bid possible or she could wait (potentially forever) to see if there is a higher bid on the way, and the auction possibly never ends.

> A traditional auction has everyone in the same room so the auctioneer gets to make timing assumptions. Whenever a higher bid has been proposed, bidders have a time window in which they can counter with a higher bid (the period during which the auctioneer yells out crazy). If the time elapses without any counter bid, then the highest bidder's candidate wins. This works because everyone in the room uses the same clock to count time. In our distributed auction, everyones' clock at home could be telling different times and ticking at different frequencies so they are not as useful to us.

On a positive note, our auction doesn't work because of the same problems the computers had while trying to come to an agreement. So how again we can use the Paxos algorithm to get come to an agreement on who wins the auction? Jamie the auction designer is curious enough to head right to the source for answers.\\
\\
**Paxos:** Ah there's a problem, You have only one auctioneer. Rookie mistake: You shouldn't have just one auctioneer.\\
**Jamie:** Um...okay. how many then?\\
**Paxos:** I don't know. how ever many you want. Just not one. I mean, what happen if that one person dies in the middle of an auction right? then everyone's screwed.\\
**Jamie**: Alright, that makes sense but can we use some other word instead of *dies*. You know, like *fail*?\\
**Paxos**: Fail? never heard that word before.\\
**Jamie**: Well if something fails then it simply stops working and never does anything more. Ever.\\
**Paxos**: Whatever. All I'm trying to say is that if you have a certain number of auctioneers that are guaranteed not to di... uhm, I mean fail, then your bidders don't have to wonder whether or not their message was received and they'll be guaranteed to eventually get a response back.\\
\\
Okay Paxos makes a valid point so let's add two more auctioneers to help Cindy out. Jane and Eve. We inform this guarantee to our bidders: at any point in time, at least two (majority of 3) auctioneers will be available. We also let them know that their bids have to be sent individually to all three auctioneers.\\
\\
Cool. But wait a minute. These auctioneers are also not able to communicate with each other since everyone's at their own home. Our tweaks may have solved the paranoia experienced by bidders but not for the auctioneers. How do they decide when it's time to proclaim a winner? We'll answer this question in a moment. First let's lay out some fundamental properties dictating what it means for our auction process to be *correct*.<a name="properties"></a>

# Correctness properties 
1. **Validity**\\
  The winning bid must have been proposed at some point in the process. The item up for bid can't be sold to Mr `T` if none of our bidders actually proposed Mr `T` as a candidate (this pretty much says no sneaky business is allowed).
2. **Uniform Agreement**\\
  There can only be one winning candidate. If for any reason someone decides that Mr `X` is the winner, then no one else should decide that someone other than Mr `X` has won.
3. **Termination**\\
  Every active bidder eventually decides on who the winner is. No one is kept waiting forever to find out this information.

We can use these properties to find potential pitfalls in our auction protocol. Already, we can only argue that number 1 is satisfied.\\
\\
**Jamie:** How does an auctioneer know when she has received all bids and no other bids are on the way? Like, when to declare a winner?\\
**Paxos:** The auctioneer doesn't have to declare a winner. Maybe the bidders who think they've won can declare their candidates the winner.\\
**Jamie:** Huh? wouldn't that be sneaky?\\
**Paxos:** Sneaky-clever. Let auctioneers remain passive. They don't communicate with each other and we already know that they can't decide when all bids have been received without potentially waiting forever. So why not let the active bidders make that decision when they think that they've won.\\
**Jamie:** So this means it all depends on bidders being one hundred percent honest with each other? that doesn't seem  very lik...\\
**Paxos:** Well, you're the one applying the algorithm on humans, I suggested it was for machines. They may plot to take over the world but at least machines are one hundred percent honest with each other.\\
\\
We'll now see how Paxos implements this idea by applying it incrementally to our auction process.

## Take 2: Auction! ######

>bidders make a decision once they've received a response from a majority of the auctioneers.

1. This time, auctioneers have an easier decision to make whenever they receive a new bid. If the new bid is the highest they've seen so far, then reply with an acknowledgement response. Otherwise, reply the bidder with a rejection response.
2. Once a bidder gets a bid accepted by a majority of auctioneers (called a **chosen** bid)<a name="chosen_bid"></a>, (s)he decides that the candidate proposed in that bid is the winner of the auction.

Here's a sample execution of an auction process from the auctioneers' point of view. Cindy receives a bid from Bob for $50 and accepts it, since it's the highest bid she's received so far.

<figure>
  <img src="/images/auction_figure_1.png">
  <figcaption><b>key:</b> proposal format => bidder(amount, candidate):response</figcaption>
</figure>

This *almost* works. Bob gets a majority of auctioneers to accept his bid and decides that his candidate Mr `Y` is the winner. But the same goes for Mark and his candidate Mr `Z`. The result is an awkward moment between Mr `Y` and Mr `Z` who both show up to collect the same precious antique.\\
\\
This happens because Cindy and Eve accept bids independent of each other. Eve (as well as Jane) saw Mark's bid before Bob's so she did what she was supposed to and accepted both. To fix this problem, we have to make sure that our bidders don't *blindly* propose their bid because the auctioneers don't communicate with each other: Bidders need to get an idea about what bids have already been accepted before proposing theirs.


## Take 3: Auction! ######

> The process of bidding becomes a two phase act. A prepare phase and an accept phase.


**Phase 1 - The prepare phase**\\
As a bidder, whenever I decide to make a bid, I send *only* the amount that I'm willing to bid. This is called a prepare request. I don't reveal my candidate just yet: Heck! I may not even have decided on which candidate to nominate at that point. I want to do this for 2 reasons.

1. **Extract a promise from the auctioneers that no lower bid will be accepted in the future.** \\
This is somewhat straightforward. Basically, I'm giving the auctioneers a sneak preview about my bid. I disclose the amount that I'm willing to bid, say $50, so they get a heads up that *most likely* a bid of $50 for *some* candidate will arrive in the future. For example, say auctioneer Cindy receives my prepare request for $50 and responds. She now has an idea that sometime in the future, a bid for $50 will arrive. During this time however, she may receive a  bid from Bob for $40. But she must reject Bob's bid, hoping that my higher bid shows up later on. For this reason, I'll interpret Cindy's response to my prepare request as an implicit **promise** that she will reject any future bids that are lower than mine. After all, that is one essence of an auction. 

2. **Find out if a lower bid has already been accepted.**\\
Auctioneers are required to accept bids as long as it's the highest they've seen so far (including prepared amounts). They couldn't be bothered about potentially conflicting candidates associated with the newer bids: Money talks so the higher bid always gets accepted. Before sending a proposal, a bidder must find out if someone else previously sent in a bid or maybe even decided on a winner. If such a person exists we want to know the details of that bid.\\
For any prepare request with amount n, An auctioneer replies with her highest accepted bid having an amount **less** than n. This bid could be an empty bid if she hasn't accepted any bids with amount lower than n.

> If theres a bid with a better chance at being chosen before yours then adopt it's candidate, otherwise simply propose any candidate of choice.

Once I receive responses from a majority of auctioneers, I go through all the bids received in these responses. If they're all empty bids, I safely proceed to phase 2 where I propose any candidate of my choice without the fear of overwriting someone else' candidate. Otherwise, I select the bid with the highest amount out of the responses and try to compete with this bid.\\
Assume I select Alice's bid to compete with in this phase. Her bid has a smaller amount than mine for sure but still her candidate is more likely to be <a href="#chosen_bid">chosen</a> before mine since it has already been accepted by some auctioneer(s) and I haven't even proposed mine yet. I *could* be stubborn and propose a different candidate but then there's a chance that both Alice's and my candidate get chosen: meaning that we're back to our original problem of two different winning candidates. I don't know for sure that Alice's candidate is going to win but I do have to nominate somebody now. So I'll play it safe and **adopt** her candidate (say, Mr `X`) as my candidate.\\
\\
Auctioneers are passive so they don't do much in phase 1. They simply wait for a bidder's prepare request and reply with the maximum bid lower than the bidder's amount.
\\
**Phase 2 - Accept phase**\\
It's time to actually propose my bid and find out if it gets **chosen**.

1. I simply Send my bid to all auctioneers and hope for the best. Similar to phase 1, I wait until I get responses from a majority of auctioneers. It doesn't even have to be the same auctioneers from phase 1 that reply this time around. Any set of a majority would do.

Here's a possible execution from the auctioneers perspective.<a name="figure_2"></a>

<figure>
  <img src="/images/auction_figure_2.png">
  <figcaption><b>key:</b> prepare request format => bidder.prep(amount)</figcaption>
</figure>

Mark has finished his prepare phase for $50 fair and square but sometime before completing his accept phase, Alice tries her own prepare phase and succeeds in getting a promise from a majority of auctioneers not to accept any lower bid than her $100. This pretty much spoils the show for mark in phase 2. He can never get his bid accepted by a majority of auctioneers: Infact, he gets two rejections in this case (represented by the X marker).

2. If *any* response from an auctioneer contains a rejection, I must quit and restart the entire process from phase 1 with a higher amount. The game can be cruel.

3. If I don't get any rejections among the majority responses I receive then I can be sure that my bid is a chosen bid and my proposed candidate is the winner.

Again, having passive auctioneers means that the job is very simple. Whenever an auctioneer receives a bid, she accepts it only if she hasn't promised some other bidder not to during their prepare phase. i.e If she hasn't received a prepare request for an amount greater than the proposed bid. Otherwise the bid must be rejected.\\
\\
And that's it! We now have a working distributed auction that makes no timing assumptions and guarantees that no two candidates can win a single round. 

## Agreement: Why it works ######
Note that it is possible for several bids to *win* an auction round. In fact, *every* active bidder must get a bid chosen in order to decide which candidate won the round. The goal is not agreement on which bidder/bid wins the round (they all do at some point), rather which *candidate* wins.\\
\\
This brings us to reasoning about how the <a href="#properties">agreement property</a> is satisfied.\\
Remember that a bidder during the prepare phase *adopts* a candidate if it suspects that someone else already started proposing. This is crucial in guaranteeing the agreement property of the paxos algorithm and our auction. Here are some important points to understanding why this auction process and paxos in general works.\\
\\
Lets assume that Mark's bid of $200 and candidate Mr `Z` has been <a href="#chosen_bid">chosen</a>. Is it safe for Mark to decide that Mr `Z` has infact won the auction item? The algorithm says yes but we try to find out for ourselves.\\
\\
The only way for Mark to be sure is if any other bids that become chosen agree with his choice of candidate Mr `Z`. This will happen for the following reasons:

1. Every higher bid subsequently *proposed* by another bidder must have Mr `Z` as its candidate because the bidder must have adopted Mr `Z` in the prepare phase.\\
Here the majority factor comes into play: for any permutation of a set of majority auctioneers, at least one of them must have at some point accepted Mark's bid and will reply with the bid containing Mr `Z` as candidate. No number less than a majority can guarantee this outcome.

2. Every subsequent higher bid that becomes *accepted* must have Mr `Z` as a candidate: this simply makes sense from 1 because an accepted bid must have been proposed earlier.

3. Every subsequent higher bid that becomes chosen must also have Mr `Z` as candidate: this in turn follows from 2. A bid can not be chosen without being accepted.\\
\\
We can see why Mark could start celebrating as soon as his bid gets chosen. Having a majority auctioneers accept his bid guarantees that his bid will show up later on when someone else tries to validate a bidding amount in their prepare phase. They must *adopt* Mark's candidate and whenever they do decide that their own bid has been chosen, it will contain Mr `Z` as candidate.


## Termination: Why it doesn't (always) work. #####
Here's a quick rundown of the auction process from my perspective as a bidder. I send a prepare request with my amount. When I receive a response from a majority regarding my prepare request, I propose my bid (after possibly adopting a candidate) and hope it gets accepted and subsequently chosen. If I get a rejection then I restart the entire process with a higher bid.\\
\\
However, consider this scenario.

<figure>
  <img src="/images/auction_figure_3.png">
  <figcaption></figcaption>
</figure>

Everyone's playing by the rules so this is a perfectly legal scenario. Mark prepares his amount for $10 but his bid gets rejected because sometime in between, some auctioneers promise Alice not to accept a lower bid than hers: <a href="#figure_2">we've seen this before</a>. The next step for Mark is to restart by preparing a higher bid, which he does right in between Alice's prepare and accept phases. For the same reason, Alice *also* gets a rejection from the auctioneers when she finally proposes her bid so she does her own quick turn around with a higher prepare amount and so on... Obviously this can go on forever without any bid being accepted. One positive takeaway is that even though the system is going haywire, no one actually makes any decisions much less wrongly declare a winner.

## FLP Ghost ######
This isn't a fault with our auction process itself. Its a phenomenon inherited from the Paxos algorithm.
Since we do not make any timing assumptions like how long messages take to be delivered or how fast auctioneers respond to messages, we assume an asynchronous setting. It is infact [impossible](http://cs-www.cs.yale.edu/homes/arvind/cs425/doc/fischer.pdf){:target="_blank"} to implement an algorithm that solves distributed consensus in an asynchronous system if there is a possiblity that even one machine might fail, and the paxos algorithm is as close as it gets.
So this doesn't mean that the algorithm is useless. There are several ways to mitigate this phenomenon. A simple fix could have a bidder wait for a random amount of time if their bid gets rejected, before restarting, hopefully giving the competition enough time to complete their accept phase. Your [favorite protocol](https://en.wikipedia.org/wiki/Exponential_backoff){:target="_blank"} for connecting to the internet uses a variant of this technique in the face of message collisions.

## The Paxos Algorithm ######
Now we know that the [Paxos algorithm](http://research.microsoft.com/en-us/um/people/lamport/pubs/paxos-simple.pdf){:target="_blank"} was designed to try to solve the problem of distributed consensus between a network of computers in an asynchronous system. What does the actual algorithm say? How does it get this group of machines to achieve consensus in the face of unpredictable failures?\\
\\
We've already answered these questions (sorta) but we'll do so here more formally by taking a sneak peek at the actual specification. Fortunately, we've pretty much covered the entire algorithm while constructing our auction protocol so there are very few surprises here.\\
Paxos uses the concepts of Proposers, Acceptors and Learners as roles in which a machine can act.\\
\\
Proposers are machines with opinions. They try to impose their opinion (value) to a set of acceptors. Analogous to our auction process, these proposers are simply bidders.\\
Acceptors accept values proposed by proposers à la auctioneers.\\
Learners decide on the agreed upon value based on the acceptors acceptances. We had our bidders decide the agreed upon value (the <a href="#chosen_bid">chosen</a> bid) in our auction. The learners simply act as external agents that declare a value to be chosen. 

>Bidders were technically acting both as proposers *and* learners. Infact it is very common for a single machine to act in all three roles in a typical setting.
{:target="_blank"}
The mechanics again, are not far off from our auction implementation. Proposers propose their value (candidate) along with a proposal number (instead of money: machines are notorious for being penniless). The proposal numbers associated with a proposal must be globally unique regardless of the proposer. In our auction this would mean that once Mark has issued a prepare request for $50, no one else can issue that exact amount. 


## Phase 1- Prepare Phase #####
**Proposer**\\
Proposals look something like `(n, v)` where n is the proposal number and v is the proposed value.
A proposer initially issues a prepare request `prepare(n)` to a set of acceptors in the hopes of extracting a promise from a majority of acceptors (a promise not to accept a proposal less than n).\\
**Acceptor**\\
If an acceptor receives a prepare request with proposal number *n*, then it is only obliged to send a response if:

1. this prepare request is the first request received by that acceptor or
2. *n* is the highest proposal number for a prepare request that acceptor has seen so far. 
\\
In both cases, the acceptor replies with the highest numbered proposal that it has accepted so far (could be an empty proposal if none has been accepted).
If neither case is true, the acceptor doesn't have to send a response at all. Not even a rejection. Obviously this means less work for the acceptors but it makes it possible for a proposer to wait indefinitely for a promise. We implemented a more practical (and polite) variant of the algorithm in our auction where we always send a response back to the proposer (even if that proposer is doomed to having his proposal rejected later on).

## Phase 2 - Accept Phase #####
**Proposer**
If a majority of acceptors have replied with a promise for a proposer's prepare request. That proposer adopts the value of the highest proposal (sorted by proposal number) from among the responses and issues an accept request (same as proposing a bid in our auction) or simply proposes its own value if all responses contain empty proposals. The accept request is sent to a set of acceptors.\\
**Acceptor**
If an acceptor receives an accept request for a proposal `(n, v)`. It sends an accept response only if it hasn't already promised some other proposer not to: i.e. if it has already responded to a prepare request `prepare(m)` such that m > n.\\ 
Again, the acceptor is not required to reply in any other case, potentially having the proposer on hold indefinitely. 
Our auction protocol uses a slightly more polite approach by sending a rejection response back to the proposer. Another option is to have the proposers timeout and restart the entire process if they don't receive a response.\\
**Learner**
In the case that a proposer has had its bid accepted by a majority of acceptor, the learners have to be notified somehow. One way to do this is to have each acceptor notify the learners whenever they accept some proposal by sending details of the accepted proposal. Then the learners can simply count in real time how many times a proposal has been accepted. 
In scenarios where the same machine acts as both a Proposer and a Learner, this feature is already built it as we've seen: the proposer simply declares its proposal to be chosen immediately.