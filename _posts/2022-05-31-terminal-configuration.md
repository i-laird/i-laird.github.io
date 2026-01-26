---
layout: post
title:  "Quality of Life Improvements for Unix CLI"
date:   2022-05-31
categories: 
  - productivity
tags:
  - mac
  - linux
  - productivity
---

Here are some of the improvements I use to make my terminal experience better on my macbook. Most of these should also work on Linux.

## Oh My ZSH
Because I use Z shell as my default shell, I am able to use [Oh my Zsh](https://ohmyz.sh/) which is absolutely amazing.

This unlocks the ability to use plugins and themes which greatly improve the experience. One theme I really like is [Dracula](https://draculatheme.com/) which can be used as the theme for both oh my zsh and for terminal.

## Plugins
Unless otherwise indicated these plugins are installed with oh my zsh and just have to be enabled by adding them to ~/.zshrc
 + [Git](https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/git): adds handy git aliases
 + [Auto Suggestions](https://github.com/zsh-users/zsh-autosuggestions): adds suggestions for auto-completion of terminal commands
    * [Installation Directions](https://github.com/zsh-users/zsh-autosuggestions/blob/master/INSTALL.md)
 + [Sudo](https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/sudo): easy way to add sudo to a command
 + [Web Search](https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/web-search): search the web through your terminal

## [Homebrew](brew.sh)
This one should be a little obvious but having brew installed makes the commandline experience much better.

Formulae can be found [here](https://formulae.brew.sh/).
``
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
``

## Applications
Here is a non-exhaustive list of applications that are good to install.

+ Cask: allows you to install applications with brew that have a GUI
  + `brew install cask`
+ [Docker](https://www.docker.com/): Install a docker server on your local machine.
  + `brew cask install docker`
+ Git
  + `brew install git`
+ AWS CLI: Allows you to interact with AWS using the terminal
  + `brew install awscli`
+ [Visual Studio Code](https://code.visualstudio.com/): One of the best lightweight text editors
  + `brew install --cask visual-studio-code`
+ [Speed Test](https://www.speedtest.net/apps/cli): allows an internet speed test to be performed in terminal.
+ [Tmux](https://www.ocf.berkeley.edu/~ckuehl/tmux/): a terminal multiplexer which is very useful for having multiple terminal windows.
  + `brew install tmux`
  + [CheatSheet](https://tmuxcheatsheet.com/)

## Github

I have recently starting using [Github over ssh](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) instead of over https like I used to. This switch was mostly caused by Github forcing Personal access tokens to be used for
communication over https, but I am really starting to like using ssh instead. It takes a little more work to set up in the beginning because 
you have to configure each computer to have its own ssh keys but as long as you keep your computer secure it seems like a great solution.

Also, I have started signing all of my commits with a [GPG](https://docs.github.com/en/authentication/managing-commit-signature-verification/adding-a-gpg-key-to-your-github-account) key. For the type of stuff I am doing on my personal account it is for
sure overkill, but it is useful to get into the habit for working in a professional environment.


