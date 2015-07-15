#!/usr/bin/env perl
use lib '/home/dan/lib-dan';
use Crawler;
use Data::Dumper;
use URI;

sub go {
	my $crawler = new Crawler(proxy => 'http://localhost:8314');
	my $headers = {
		mf_action => 'visit',
		mf_timeout => 10000,
		mf_load_external => 1,
		mf_load_media => 1,
		mf_return_on_timeout => 0,
		mf_keep_alive => 1,
		mf_require_proxy => 0,
		mf_user_agent => $crawler->user_agent,
	};
	
	$crawler->headers($headers);
	my $resp = $crawler->get('http://danchrostowski.com/testing/headless2.html');
	print Dumper $resp;
	$headers->{mf_action} = 'test_jquery';
	$headers->{mf_keep_alive} = 0;
	$crawler->get('http://danchrostowski.com/testing/headless2.html');
	
	
	
}

go();
