---
layout: post
title: Client-side haskell
categories: posts
excerpt: "Hands on tutorial on using haskell to create client-side applications"
tags: [haskell, haste, tutorial, functional programming]
image:
  feature: pong.jpg
  credit: ...storrao...
  creditlink: https://www.flickr.com/photos/storrao/6297918945/
---
Hi! before introducing this post let's do some myth busting! &#128526;  

>Purely functional programming languages have no place in the browser and Haskell is a magical genius language that everyone talks about but no one really uses.

Truth is, haskell is not a difficult language to program in and it's past reputation of never being used in the industry [has always been uncalled for](https://code.facebook.com/posts/745068642270222/fighting-spam-with-haskell/){:target="_blank"}. 
As for how we can use it to program applications for the web, there are some really [cool](http://elm-lang.org){:target="_blank"} [projects](https://github.com/ghcjs/ghcjs){:target="_blank"} that make this possible and this post will show you just that.

This will be a hands on tutorial on how to use [Haste](http://haste-lang.org){:target="_blank"}, a Haskell to Javascript compiler that allows you to write Haskell code that can be executed on the web. We will be creating a simple pong game while exploring some of the features of the Haste environment. You can check the game out [over here](/demo/pong.html){:target="_blank"}.

This tutorial assumes that you have basic knowledge of haskell or some other functional programming language. [Install Haste](http://haste-lang.org/downloads/) on your machine to get started. It requires [GHC](https://www.haskell.org/ghc/){:target="_blank"}, the Glasgow Haskell Compiler so you want to install that first if you don't have it already. 

That aside, let's begin our pong game.

##Rules of the game
There are two paddles and one ball.  
When the ball hits any of the walls (right, left) or paddles, it should change its direction.  
When a ball hits the ceiling or floor, the game should end.  
Paddles should be controlled by the player's mouse. (Not really a rule of the game but hey!)

First, we import some useful functions and datatypes from the Haste libraries. Create a file called **pong.hs** and add the following statements to the top of the file.

{% highlight ruby %}
import Haste
import Haste.Graphics.Canvas
import Data.IORef
{% endhighlight %}


# Step 1 - Defining Our Game state and Initial Declarations
We start by declaring a datatype `GameState`. We'll use it to describe the state of our game at any given moment, using values like the ball and paddle position, current score, speed of the ball. Add this code to **pong.hs**.

{% highlight haskell %}
  data GameState = GameState{
    ballPos :: Point, -- position of ball
    ballSpeed :: Point, -- how far will ball move in a single update
    paddlePos:: Double, -- start position of paddle on x axis
    score  :: Int
  }
{% endhighlight %}

Note that the `paddlePos` field has a single value. You might expect that we need to store the full dimensions of the paddles (x and y coordinates) but as you will see very soon, the other values never change and so are declared as constants instead of passing them around in our game state.

Now we define constants to be used throughout the program. These include the dimensions of the canvas and partial dimensions of paddles, radius of the ball etc.

{% highlight haskell %}
width, height,ballRadius, paddleWidth, paddleHeight :: Double
width = 500 -- width of canvas
height = 600 -- height of canvas
ballRadius = 5 --radius of ball
paddleHeight = 5 -- height of paddle
paddleWidth = 150 -- width of paddle
halfWidth = width / 2 -- well, half the width
halfHeight = height / 2 --also half the height

scoreLabel :: String
scoreLabel = "Score: "
{% endhighlight %}


Also define a state describing the initial values of our game.

{% highlight haskell %}
initialState :: GameState
initialState = GameState{
 	ballPos = (20, 20),
 	ballSpeed = (8, 10),
	paddlePos = (width / 2) - 75, --position around center of canvas
	score = 0
}
{% endhighlight %}


# Step 2 - Canvas, Paddles and Ball
Our animation is going to be on an HTML canvas but we can make life easier by abstracting the process of creating a canvas. We define a function `mkCanvas`  
`mkCanvas :: Double -> Double -> IO Elem`  
The type signature tells us in a nutshell that we give it two doubles (width and height of our canvas) and receive instructions for creating a HTML element as per Haskell monads. This is the body of the function.
{% highlight haskell %}
mkCanvas width height = do
	canvas <- newElem "canvas"
	setProp canvas "width" (show width)
	setProp canvas "height" (show height)
	setStyle canvas "display" "block"
	setStyle canvas "border" "1px solid black"
	setStyle canvas "margin" "0px auto 0 auto"
	setStyle canvas "backgroundColor" "black"
	return canvas
{% endhighlight %}

This function creates a new canvas html element using the newElem function from the [Haste.Graphics.Canvas](https://hackage.haskell.org/package/haste-compiler-0.4/docs/Haste-Graphics-Canvas.html){:target="_blank"} library, sets its dimensions (height, width) and assigns some other housekeeping properties like color, border etc.  

> This library also gives us functions for creating basic shapes and pictures. Here are some we will be using
{% highlight haskell %}
circle :: Point -> Double -> Shape() -- draw a circle at given Point with given radius
rect   :: Point -> Point  -> Shape() -- draw a rectangle between two points
color  :: Color -> Picture() -> Picture() -- draw the given picture using the specified color
{% endhighlight %}

>A Point is simply a pair of floats which may or may not represent x and y coordinates in pixels

{% highlight haskell %}
type Point = (Double, Double)
{% endhighlight %}

Now back in our game, we can use the color function to define our color theme.

{% highlight haskell %}
white :: Picture () -> Picture () 
white = color (RGB 255 255 255) -- or whichever color you like
{% endhighlight %}

For our ball and paddles, we use a familiar technique of abstracting the creation process using factory functions. Add this to **pong.hs**.

{% highlight haskell %}
ball :: Point -> Picture ()
ball pt = color (RGB 255 255 255) $ do
  fill $ circle pt ballRadius

paddle :: Rect -> Picture () 
paddle (Rect x1 y1 x2 y2) = white $ do
  fill $ rect (x1, y1) (x2, y2)

drawText :: Point -> String -> Picture ()
drawText point msg = white $ do 
  text point msg
{% endhighlight %}

All three functions are very similar to each other. Their type signature tells us they receive a set of values and return a Picture monad `Picture()`, instructions for drawing their respective shapes on a canvas. the `drawText` function writes text on the canvas.




# Step 3 - Drawing on the canvas
At this point we have functions for creating our paddles, ball and canvas. It's about time that we actually use them to well, create paddles, ball and a canvas.   
We want to draw a picture of our game on the canvas and to do that we first need a picture of our game. This is where our `GameState` type comes into play (Pun intended! &#128530;).  

{% highlight haskell %}
gamePicture :: GameState -> Picture ()
gamePicture state = do
  ball $ ballPos state -- ball position from `state`
  let x1 = paddlePos state -- paddle start position
      x2 = x1 + paddleWidth -- end position of paddle
  paddle $ Rect x1 0 x2 paddleHeight -- top paddle
  paddle $ Rect x1 (height - paddleHeight) x2 height -- bottom paddle
  font "20px italic Monospace" $ drawText (30,50) $ scoreLabel ++ show (score state) -- write the score onto the canvas
{% endhighlight %}

The `gamePicture` function takes as an argument, a `GameState` and returns a Picture monad. So it basically gives you a picture based on our given game state which we can the render on our canvas. So what's going on here?  

In a do block, we create 4 pictures (Picture monads to be technical) to draw on the canvas.  
*1.* The ball. Using the ballPos field of the given state as our argument to the `ball` function.  
*2. and 3.* The top and bottom paddles. Using the `paddle` function and their coordinates. Notice that we only needed the paddle's **x** coordinate from the state, the rest can be inferred from the paddle's orientation (Top or Bottom). The top paddle starts at height **0** while the bottom baddle starts right before the end of the canvas **(height - paddleHeight)**.  
4. The text field showing the score on the canvas using the `drawText` function.  

While `gamePicture` produces the picture, the `renderState` function will do the actual rendering onto a canvas.

{% highlight haskell %}
renderState :: Canvas -> GameState -> IO ()
renderState canvas state = render canvas $ do
	gamePicture state
{% endhighlight %}

The render function is imported from haste and draws a given picture (or series of pictures using a do block) on the specified canvas.  

We move on to (finally &#128513;) create our canvas.  
We'll create the canvas inside our `main` function. The main function `main :: IO ()` in haskell, unlike any other function has to be called main and is the entry point of our program just like in C, Java etc.

{% highlight haskell %}
main :: IO ()
main = do
  canvasElem <- mkCanvas width height
  addChild canvasElem documentBody
  Just canvas <- getCanvas canvasElem
  renderState canvas initialState
{% endhighlight %}


At this point you can check that the screen is drawn as it should. Compile the program by running this command in a terminal.
{% highlight bash %}
$ hastec --output-html pong.hs 
{% endhighlight %}

Haste automagically creates an HTML file called pong.html with the javascript version of our code embedded. You may omit the `--output-html` option if you just want the javascript file. Open the html file in a web browser and you should see a canvas, two paddles, a ball and a score card. But they are static and that's because we havent added any animation to them yet. We do that next.

# Step 4 - Animation
We continue with ball animation. The `ballSpeed` field of our `GameState` type is useful for this purpose. Simply put, everytime the screen is redrawn, we want the ball to change its position on the canvas. Incrementing the x and y coordinates of the ball by a value everytime gives us this effect and these values are what we have as `ballSpeed` in our `GameState`.
{% highlight haskell %}
moveBall :: GameState -> GameState
moveBall state = state {ballPos = (x + vx, y + vy)} --increment by vx and vy
  where
  	(x, y)   = ballPos state
  	(vx, vy) = ballSpeed state
{% endhighlight %}


`moveBall` increments the x and y coordinates of the ball and returns a new `GameState` with the new coordinates. Note that there is no mutation/side effects here as the function does indeed return a new value.  

Our paddles will be controlled by the mouse so we need to listen for mouse events, specifically the **mousemove** event.   
To add an event listener to our game, we go back to our `main` function. 
Now **REMOVE** the last statement `renderState canvas initialState` from the `do` block as we will no longer be needing it. Instead, add the following statements to the do block.

{% highlight haskell %}
stateRef <- newIORef $ initialState
onEvent canvasElem OnMouseMove $ \mousePos -> do
		movePaddles mousePos stateRef
{% endhighlight %}


Remember that thing about Haskell being a purely functional language? Whoever said that didn't finish the entire story it seems. Variables **are immutable** in Haskell but there are a few ways to create references whereby we can change what the reference points to.  

We won't be able to do a lot without interacting with the real world now that we need to process mouse events from the user, so we use the [IORef monad](https://hackage.haskell.org/package/base-4.8.1.0/docs/Data-IORef.html){:target="_blank"} to do the job. This is the first sighting of mutation in our code but don't be alarmed if you haven't seen this before. The `Data.IORef` makes it quite easy and safe to do this.  
The first statement creates a reference object of type `IORef GameState` using the `newIORef` function. This creates a new `GameState` reference with our initialState, allowing us to modify its contents throughout our code.  
The second statement adds a mousemove event to the canvas element. The `onEvent` function provided by Haste takes an `Elem`  and an `Event` while `Event` constructor take as arguments a callback function à la Javascript. Our callback function `\mousePos -> do movePaddles mousePos stateRef` receives the mouse position `mousePos` and moves the paddles whenever the mousemove event fires.  
Here is the code to move our paddles.

{% highlight haskell %}
movePaddles :: (Int, Int) -> IORef GameState -> IO ()
movePaddles (mouseX, mouseY) stateRef = do
  state <- readIORef stateRef
  atomicModifyIORef stateRef (\state -> ((state {paddlePos = (fromIntegral mouseX) - (paddleWidth / 2)}), ()))
{% endhighlight %}

`readIORef` extracts the `GameState` referenced by our state reference `stateRef` while `atomicModifyIORef` changes the referenced content using the extracted state. The `atomicModifyIORef` function unlike the `modifyIORef` mutates the variable atomically, preventing race conditions and the likes. Our state is simply updated by centering the position of the paddle around the mouse coordinates

Now we move on to define our primary animation function. Let's call it `animate`. It takes a Canvas, an `IORef GameState` (for rendering onto canvas) and returns an IO monad `IO ()` .

{% highlight haskell %}
animate :: Canvas -> IORef GameState -> IO ()
animate canvas stateRef = do
	state <- readIORef stateRef -- extract state from reference object
	renderState canvas state -- draw game picture
	atomicWriteIORef stateRef $ update state -- update state and rewrite state reference
	setTimeout 30 $ animate canvas stateRef  -- sleep. then loop

 where
  update = moveBall
{% endhighlight %}


 `animate` updates that state with the update function, writes the updated state back to the state variable then waits 30 milliseconds before repeating the whole process so it runs in a loop.
 Later on we'll add a few more functions used to compose the update function but for now it consists only of the `moveBall`. `atomicWriteIORef` is similar to `atomicModifyIORef` but overwrites the variable with a new state. This feels more efficient here since we can extract our pure state, pass it around various functions composed by the update function and then, only once do we need to commit the sinful act of changing the value referenced by our `IORef` monad  &#128519;.  

Now add the following as the last line of our main function
`animate canvas stateRef`  

 Our main function should look like this
{% highlight haskell %}
main :: IO ()
main = do
  canvasElem <- mkCanvas width height
  addChild canvasElem documentBody
  Just canvas <- getCanvas canvasElem
  stateRef <- newIORef $ initialState
  onEvent canvasElem OnMouseMove $ \mousePos -> do
		movePaddles mousePos stateRef
  animate canvas stateRef
{% endhighlight %}

# Step 5 - Detecting Collision
We've got our ball and paddles moving and what's left is making the ball bounce.  
The rules of our game requires the ball to bounce when it hits any of the walls or paddles.
Let's start with the paddles. Here's our function `paddleHit` to detect collision between the ball and the paddle
{% highlight haskell %}
paddleHit :: GameState -> GameState
paddleHit state = 
  if and [bx' >= px, bx'' <= pl, (by >= height-ph) || (by <= ph)] -- if ball is touching paddle
  then state {ballSpeed = (vx, -vy), score = score state + 1} -- change ball direction and increase score
  else state    -- otherwise do nothing
 where
  (bx,by) = ballPos state -- x and y coordinates of ball
  bx' = bx + ballRadius -- right edge of ball
  bx'' = bx - ballRadius -- left edge of ball
  (vx,vy) = ballSpeed state -- current ball speed
  px = paddlePos state -- x coordinate of paddle / left edge
  ph = paddleHeight -- ph is easier to type
  pl = px + paddleWidth -- right edge of paddle
{% endhighlight %}

`paddleHit` checks if the ball coordinates are within the dimensions of the paddles and if so, returns a new `GameState` wherein the ball now heads in the opposite direction. This is accomplished by simply negating the vertical speed value of the ball. We also increment the score for each time the ball hits the paddle.  


Note that for the paddleHit function, the `and` function short-circuit evaluates, so once an expression returns false, we simply return our state unchanged.

Detecting collision with walls is similar to the paddles.

{% highlight haskell %}
-- Change ball direction if ball hits walls
wallCollision :: GameState -> GameState
wallCollision state
  | (x + ballRadius) >= width = state {ballPos = (width - ballRadius,y), ballSpeed = (-vx, vy)} -- if ball crosses right boundary
  | (x + ballRadius) <= 0 = state {ballPos = (ballRadius, y), ballSpeed = (-vx, vy)} -- ball crosses left boundary
  | otherwise = state -- do nothing
 where
  (x, y) = ballPos state
  (vx,vy) = ballSpeed state
{% endhighlight %}

We simply check if the ball crosses the right or left wall and if so, negate the horizontal speed of the ball.  



Now we have our functions to detect collision with the walls and paddles. Let's use them to compose our `update` function. Go to the `animate` function. Currently the update function defined within it consists only of `moveBall` so add our two new functions to it by replacing the definition of update with this line of code.  
{% highlight haskell %}
update = moveBall . paddleHit . wallCollision
{% endhighlight %}

The last rule of the game to be implemented is that the game should end when the ball hits the ceiling or the floor. That means we also need to check for ball collisions with the ceiling and floor of our canvas. Add this function to the code.

{% highlight haskell %}
gameEnded :: GameState -> Bool
gameEnded state
	| y >= height && (x < px || x > px + paddleWidth) = True -- if ball reaches floor and not touching paddle
	| y <= 0 && (x < px || x > px + paddleWidth) = True -- if ball reaches ceiling and not touching paddle
	| otherwise = False 
 where
   (x,y) = ballPos state -- ball position
   px = paddlePos state -- paddle position 
{% endhighlight %}


`gameEnded` returns a `Bool` telling us if the game should end. That is, if the ball has collided with any of the vertical boundaries that isn't the paddle. To make use of this function, we go back to our `animate` function and make our decision on whether to stop animating or not, based on the reply from `gameEnded`. Our `animate` function should now look like this
{% highlight haskell %}
animate :: Canvas -> IORef GameState -> IO ()
animate canvas stateRef = do
	state <- readIORef stateRef
	renderState canvas state -- draw game picture
	if gameEnded state
	then 
	    renderState canvas state -- render one last time and quit
	else
	    do
	    atomicWriteIORef stateRef $ update state -- else update state 
	    setTimeout 30 $ animate canvas stateRef -- and continue

 where
	update = moveBall . paddleHit . wallCollision
{% endhighlight %}


**Wow**! this is a really lengthy tutorial &#128565;. We were bound to reach this part at some point and good news is you now have written a game of pong in haskell.  
Personally I'm a huge fan of Javascript as well so one thing I think is really cool about Haste is that you still get that *Javascripty* feeling, programming in it. Haste doesn't take that away from you by forcing you to do things like DOM manipulation or event listening in a different way.  

You may have seen that I included some extra features in the [live demo](/demo/pong.html){:target="_blank"} such as start, restart buttons and speed of the ball increasing during the game. [Browse through the code](https://github.com/iffyio/pong.hs/blob/master/pong.hs){:target="_blank"} to see how these were implemented, then try to implement them and add more features to your game or [fork this one on github](https://github.com/iffyio/pong.hs){:target="_blank"} and continue from there. If you get stuck in implementation somewhere, leave me a message/comment and I'll be sure to help you as much as I can.