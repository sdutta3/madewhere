from typing import List, Dict
import scrapy
from scrapyscript import Job, Processor
from scrapy.crawler import CrawlerProcess
import json

from scraper.scrapy_spiders import ProductReviewAmazonComSpider


class ProductReviewAmazonComScraper:
    def __init__(self, url: str):
        """
        Args:
            url (str): For example, "https://www.amazon.com/dp/B07Q6H83VY"
            https://www.amazon.com/Square-Schneider-Electric-9013FHG39J68M1X-Air-Compressor/dp/B00CONA2RM/ref=sr_1_57?dchild=1&keywords=chinese+knock+off&qid=1624859523&sr=8-57
            https://www.amazon.com/Square-Schneider-Electric-9013FHG39J68M1X-Air-Compressor/dp/B00CONA2RM/ref=sr_1_57
        """
        self.url = url

    def scrape(self) -> List[str]:
        job1 = Job(ProductReviewAmazonComSpider, url=self.url)

        settings = {
            'USER_AGENT': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",  # "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 5.1)",
            "COOKIES_ENABLED": True,
            "ACCEPT": "*/*",
            "ACCEPT-ENCODING": "gzip, deflate, br",
            "ACCEPT-LANGUAGE": "en-US,en;q=0.9",
            "CONTENT-LENGTH": "840",
            "CONTENT-TYPE": "text/plain;charset=UTF-8",
            "DNT": "1",
            "ORIGIN": "https://www.amazon.com",
            "REFERER": "https://www.amazon.com/",
            "SEC-CH-UA": '" Not;A Brand";v="99", "Google Chrome";v="91", "Chromium";v="91"',
            "SEC-CH-UA-MOBILE": "?0",
            "SEC-FETCH-DEST": "empty",
            "SEC-FETCH-MODE": "no-cors",
            "SEC-FETCH-SITE": "same-site",
        }

        # Create a Processor, optionally passing in a Scrapy Settings object.
        processor = Processor(settings=settings)

        # Start the reactor, and block until all spiders complete.
        spider_result = processor.run([job1])

        # # Print the consolidated results
        # print(json.dumps(spider_result))

        collection_of_reviews = self._convert_spider_result_to_collection_of_reviews(spider_result=spider_result)
        return collection_of_reviews

    def _convert_spider_result_to_collection_of_reviews(self, spider_result: Dict) -> List[str]:
        collection_of_reviews = []
        for review_struct in spider_result:
            review = str(review_struct.get("content", ""))
            collection_of_reviews.append(review)
        return collection_of_reviews
